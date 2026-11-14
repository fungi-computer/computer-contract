import assert from "node:assert/strict";
import console from "node:console";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  console.log("git changes decoder ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
