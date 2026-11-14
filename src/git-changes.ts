import * as z from "zod";

/** The most changed files one reply names; a larger change set says it was cut. */
export const maximumGitChangeFiles = 500;
/** The most patch characters one reply carries. */
export const maximumGitChangePatchCharacters = 60_000;

/** Asks for the working-tree changes of the Git repository holding one folder. */
export const gitChangesInputSchema = z.strictObject({
  /** A folder on this Computer, or any folder inside the repository; the Computer's root when omitted. */
  path: z
    .string()
    .min(1)
    .max(4_096)
    .startsWith("/")
    .refine((path) => !path.includes("\0"), "Path cannot contain null bytes")
    .default("/"),
});
/** What changed for one file, as Git's status reports it. */
export const gitChangeStatusSchema = z.enum({
  /** The file is new and staged. */
  added: "added",
  /** The file exists in the last commit and differs from it. */
  modified: "modified",
  /** The file is gone from the working tree. */
  deleted: "deleted",
  /** The file moved; `renamedFrom` names where it came from. */
  renamed: "renamed",
  /** The file is new and not yet staged. */
  untracked: "untracked",
  /** A merge left the file unresolved. */
  conflicted: "conflicted",
});
/** One changed file, named from the repository root. */
export const gitChangedFileSchema = z.strictObject({
  /** The file's path from the repository root. */
  path: z.string().min(1).max(4_096),
  /** What changed. */
  status: gitChangeStatusSchema,
  /** Where a renamed file used to be. */
  renamedFrom: z.string().min(1).max(4_096).optional(),
});
/** The working-tree changes of one repository, or the absence of one. */
export const gitChangesOutputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    /** The folder is not inside a Git working tree. */
    kind: z.literal("not_repository"),
  }),
  z.strictObject({
    /** The folder is inside a Git working tree. */
    kind: z.literal("changes"),
    /** The Computer path of the repository root. */
    root: z.string().min(1).max(4_096),
    /** The checked-out branch, or null on a detached head. */
    branch: z.string().min(1).max(1_024).nullable(),
    /** Changed files, at most `maximumGitChangeFiles`. */
    files: z.array(gitChangedFileSchema).max(maximumGitChangeFiles),
    /** One unified diff against the last commit; untracked files appear as additions. */
    patch: z.string().max(maximumGitChangePatchCharacters),
    /** True when the file list or patch was cut to its bound. */
    truncated: z.boolean(),
  }),
]);
/** The working-tree changes of one repository, or the absence of one. */
export type GitChangesOutput = z.output<typeof gitChangesOutputSchema>;
/** One changed file, named from the repository root. */
export type GitChangedFile = z.output<typeof gitChangedFileSchema>;

/**
 * The one command the Computer runs for a Changes read. It takes no
 * arguments: the folder is the command's working directory, so no caller text
 * reaches the shell. Records are NUL-separated so any file name round-trips.
 */
export const gitChangesCommand = [
  "exec 2>/dev/null",
  "[ \"$(git rev-parse --is-inside-work-tree)\" = true ] || { printf 'fungi:not-repository\\0'; exit 0; }",
  "printf 'fungi:repository\\0'",
  "git rev-parse --show-prefix | tr -d '\\n'; printf '\\0'",
  'cd "$(git rev-parse --show-toplevel)" || exit 0',
  "git -c core.fsmonitor=false -c core.quotepath=off status --porcelain=v2 --branch -z --untracked-files=all",
  "printf 'fungi:patch\\0'",
  "base=$(git rev-parse -q --verify HEAD || git hash-object -t tree /dev/null)",
  'git -c core.fsmonitor=false diff --no-ext-diff --no-textconv --no-color --find-renames "$base"',
  "git -c core.fsmonitor=false ls-files --others --exclude-standard -z | xargs -r -0 -n 1 git diff --no-index --no-ext-diff --no-textconv --no-color -- /dev/null",
  "exit 0",
].join("\n");

const patchRecord = "\0fungi:patch\0";

function changeStatus(code: string): GitChangedFile["status"] {
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  if (code.includes("R")) return "renamed";
  return "modified";
}

/**
 * Decode `gitChangesCommand` output, already stripped of any execution
 * truncation marker. Porcelain v2 with -z is Git's own
 * machine format: `# branch.*` headers, `1`/`2`/`u` change records and `?`
 * untracked records, with a rename's origin as the record after it.
 */
export function decodeGitChanges(
  output: string,
  options: Readonly<{ path: string; truncated: boolean }>,
): GitChangesOutput {
  if (output.startsWith("fungi:not-repository\0"))
    return { kind: "not_repository" };
  const header = "fungi:repository\0";
  const cut = output.indexOf(patchRecord);
  if (!output.startsWith(header) || cut < 0)
    throw new Error("Git changes output is malformed");
  const statusText = output.slice(header.length, cut + 1);
  let patch = output.slice(cut + patchRecord.length);
  const records = statusText.split("\0");
  const prefix = (records.shift() ?? "").replace(/\/$/u, "");
  const rootPath =
    prefix === "" ? options.path : options.path.slice(0, -prefix.length - 1);
  let branch: string | null = null;
  const files: GitChangedFile[] = [];
  let capped = options.truncated;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record === "") continue;
    const tag = record[0];
    if (tag === "#") {
      const head = /^# branch\.head (.+)$/u.exec(record)?.[1];
      if (head !== undefined) branch = head === "(detached)" ? null : head;
      continue;
    }
    const fields = record.split(" ");
    let file: GitChangedFile;
    if (tag === "?") file = { path: record.slice(2), status: "untracked" };
    else if (tag === "1")
      file = {
        path: fields.slice(8).join(" "),
        status: changeStatus(fields[1] ?? ""),
      };
    else if (tag === "2") {
      index += 1;
      file = {
        path: fields.slice(9).join(" "),
        status: "renamed",
        renamedFrom: records[index] ?? "",
      };
    } else if (tag === "u")
      file = { path: fields.slice(10).join(" "), status: "conflicted" };
    else throw new Error("Git changes output is malformed");
    if (file.path === "") throw new Error("Git changes output is malformed");
    if (files.length === maximumGitChangeFiles) {
      capped = true;
      break;
    }
    files.push(file);
  }
  if (patch.length > maximumGitChangePatchCharacters) {
    patch = patch.slice(
      0,
      patch.lastIndexOf("\n", maximumGitChangePatchCharacters) + 1,
    );
    capped = true;
  }
  return gitChangesOutputSchema.parse({
    kind: "changes",
    root: rootPath === "" ? "/" : rootPath,
    branch,
    files,
    patch,
    truncated: capped,
  });
}
