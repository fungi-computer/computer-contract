import assert from "node:assert/strict";
import console from "node:console";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import process from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeGitChanges, gitChangesCommand } from "../dist/index.js";

const root = mkdtempSync(join(tmpdir(), "git-changes-"));
const git = (...args) =>
  execFileSync("git", args, { cwd: root, stdio: "pipe" });
const run = (cwd) =>
  execFileSync("sh", ["-c", gitChangesCommand], {
    cwd,
    encoding: "utf8",
  });
try {
  assert.deepEqual(
    decodeGitChanges(run(tmpdir()), { path: "/", truncated: false }),
    {
      kind: "not_repository",
    },
  );
  git("init", "-q", "-b", "main");
  git("config", "user.email", "a@b.c");
  git("config", "user.name", "t");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "kept.txt"), "one\ntwo\n");
  writeFileSync(join(root, "gone.txt"), "bye\n");
  writeFileSync(join(root, "moved.txt"), "moving\nmoving\nmoving\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  writeFileSync(join(root, "src", "kept.txt"), "one\nthree\n");
  rmSync(join(root, "gone.txt"));
  git("mv", "moved.txt", "renamed.txt");
  writeFileSync(join(root, "staged.txt"), "staged\n");
  git("add", "staged.txt");
  writeFileSync(join(root, "new file.txt"), "fresh\n");
  const decoded = decodeGitChanges(run(join(root, "src")), {
    path: "/work/src",
    truncated: false,
  });
  assert.equal(decoded.kind, "changes");
  assert.equal(decoded.root, "/work");
  assert.equal(decoded.branch, "main");
  assert.deepEqual(
    Object.fromEntries(decoded.files.map((file) => [file.path, file.status])),
    {
      "src/kept.txt": "modified",
      "gone.txt": "deleted",
      "renamed.txt": "renamed",
      "staged.txt": "added",
      "new file.txt": "untracked",
    },
  );
  assert.equal(
    decoded.files.find((file) => file.status === "renamed").renamedFrom,
    "moved.txt",
  );
  for (const heading of [
    "diff --git a/src/kept.txt b/src/kept.txt",
    "diff --git a/gone.txt b/gone.txt",
    "diff --git a/staged.txt b/staged.txt",
    "diff --git a/new file.txt b/new file.txt",
  ])
    assert.ok(decoded.patch.includes(heading), heading);
  assert.ok(decoded.patch.includes("+fresh"));
  assert.equal(decoded.truncated, false);
  assert.throws(() =>
    decodeGitChanges("nonsense", { path: "/", truncated: false }),
  );

  // Anyone who can write files can write a repository's config, attributes
  // and the home Git config. A Changes read is not a command: no driver from
  // any of those sources may run.
  const ran = join(root, "driver-ran");
  const home = join(root, "home");
  mkdirSync(home);
  const driver = `touch '${ran}'; cat`;
  git("config", "filter.planted.clean", driver);
  git("config", "filter.planted.process", `touch '${ran}'`);
  git("config", "filter.planted.required", "true");
  git("config", "diff.planted.command", driver);
  git("config", "core.fsmonitor", driver);
  writeFileSync(
    join(home, ".gitconfig"),
    `[filter "home"]\n\tclean = ${driver}\n[core]\n\tattributesFile = ${join(home, "attributes")}\n`,
  );
  writeFileSync(join(home, "attributes"), "* filter=home\n");
  writeFileSync(
    join(root, ".gitattributes"),
    "* filter=planted diff=planted\n",
  );
  mkdirSync(join(root, ".git", "info"), { recursive: true });
  writeFileSync(join(root, ".git", "info", "attributes"), "* filter=planted\n");
  writeFileSync(join(root, "src", "kept.txt"), "one\nfour\n");
  const planted = execFileSync("sh", ["-c", gitChangesCommand], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
  });
  assert.equal(existsSync(ran), false, "a planted Git driver ran");
  const read = decodeGitChanges(planted, { path: "/work", truncated: false });
  assert.equal(read.kind, "changes");
  assert.equal(read.branch, "main");
  assert.equal(
    read.files.find((file) => file.path === "src/kept.txt")?.status,
    "modified",
  );
  assert.ok(read.patch.includes("+four"));
  assert.ok(read.patch.includes("+fresh"));

  // The repository's line-ending settings and split index still apply: a
  // CRLF checkout whose files were only touched shows no changes, and an
  // edit under a split index is still read.
  const crlf = join(root, "crlf");
  mkdirSync(crlf);
  const inCrlf = (...args) =>
    execFileSync("git", args, { cwd: crlf, stdio: "pipe" });
  inCrlf("init", "-q", "-b", "main");
  inCrlf("config", "user.email", "a@b.c");
  inCrlf("config", "user.name", "t");
  inCrlf("config", "core.autocrlf", "true");
  writeFileSync(join(crlf, "dos.txt"), "one\r\ntwo\r\n");
  writeFileSync(join(crlf, "split.txt"), "before\n");
  inCrlf("add", ".");
  inCrlf("commit", "-q", "-m", "base");
  inCrlf("update-index", "--split-index");
  const later = new Date(Date.now() + 5_000);
  utimesSync(join(crlf, "dos.txt"), later, later);
  writeFileSync(join(crlf, "split.txt"), "after\n");
  const settings = decodeGitChanges(run(crlf), {
    path: "/crlf",
    truncated: false,
  });
  assert.equal(settings.kind, "changes");
  assert.deepEqual(settings.files, [{ path: "split.txt", status: "modified" }]);
  assert.ok(settings.patch.includes("+after"));
  console.log("git changes decoder ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
