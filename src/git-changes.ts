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
 *
 * A Changes read needs only file read, yet anyone who can write files can
 * write the repository's config and attributes, and Git runs the filter, diff
 * and fsmonitor commands those name. So Git reads the working tree through a
 * throwaway Git directory whose config this command writes: the repository's
 * objects, index (split or not), branch, excludes and line-ending settings,
 * and no other config from it, the home config or the system config.
 * Attributes then name drivers that do not exist, and Git applies only its
 * built-in conversions. Submodules are not read, since Git would run inside
 * each with that submodule's own config.
 */
export const gitChangesCommand = String.raw`exec 2>/dev/null
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT \
  GIT_EXTERNAL_DIFF GIT_ATTR_SOURCE
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_OPTIONAL_LOCKS=0 \
  GIT_TERMINAL_PROMPT=0 GIT_NO_LAZY_FETCH=1
[ "$(git rev-parse --is-inside-work-tree)" = true ] || { printf 'fungi:not-repository\0'; exit 0; }
printf 'fungi:repository\0'
git rev-parse --show-prefix | tr -d '\n'; printf '\0'
top=$(git rev-parse --show-toplevel) && cd "$top" || exit 0
index=$(git rev-parse --path-format=absolute --git-path index) || exit 0
objects=$(git rev-parse --path-format=absolute --git-path objects) || exit 0
exclude=$(git rev-parse --path-format=absolute --git-path info/exclude) || exit 0
format=$(git rev-parse --show-object-format) || exit 0
head=$(git rev-parse -q --verify HEAD)
branch=$(git symbolic-ref -q HEAD)
shadow=$(mktemp -d) || exit 0
trap 'rm -rf "$shadow"' EXIT
mkdir "$shadow/refs" "$shadow/info" || exit 0
git config -f "$shadow/config" core.repositoryformatversion 1 || exit 0
git config -f "$shadow/config" extensions.objectFormat "$format" || exit 0
git config -f "$shadow/config" core.bare false || exit 0
git config -f "$shadow/config" core.quotepath false || exit 0
for key in core.filemode core.ignorecase core.symlinks core.precomposeunicode; do
  value=$(git config --type=bool "$key") || continue
  git config -f "$shadow/config" "$key" "$value" || exit 0
done
for key in core.autocrlf core.eol; do
  value=$(git config "$key") || continue
  git config -f "$shadow/config" "$key" "$value" || exit 0
done
gitdir=$(git rev-parse --absolute-git-dir) || exit 0
for shared in "$gitdir"/sharedindex.*; do
  [ ! -f "$shared" ] || ln -s "$shared" "$shadow/" || exit 0
done
[ ! -f "$exclude" ] || cp "$exclude" "$shadow/info/exclude" || exit 0
if [ -n "$branch" ]; then printf 'ref: %s\n' "$branch"; else printf '%s\n' "$head"; fi >"$shadow/HEAD"
export GIT_DIR="$shadow" GIT_WORK_TREE="$top" GIT_INDEX_FILE="$index" GIT_OBJECT_DIRECTORY="$objects"
[ -z "$branch" ] || [ -z "$head" ] || git update-ref "$branch" "$head" || exit 0
git status --porcelain=v2 --branch -z --untracked-files=all --ignore-submodules=all
printf 'fungi:patch\0'
base=$(git rev-parse -q --verify HEAD || git hash-object -t tree /dev/null)
git diff --no-ext-diff --no-textconv --no-color --find-renames --ignore-submodules=all "$base"
git ls-files --others --exclude-standard -z | xargs -r -0 -n 1 git diff --no-index --no-ext-diff --no-textconv --no-color -- /dev/null
exit 0`;

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
