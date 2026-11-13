import assert from "node:assert/strict";
import console from "node:console";
import {
  ComputerFileMoveError,
  computerCapabilities,
  computerOperationSchema,
  moveInputSchema,
  moveOutputSchema,
} from "../dist/index.js";

assert.equal(computerOperationSchema.parse("files.move"), "files.move");
assert.deepEqual(moveInputSchema.parse({ from: "/a", to: "/b" }), {
  from: "/a",
  to: "/b",
  createParents: false,
});
assert.equal(
  moveInputSchema.parse({ from: "/a", to: "/b", createParents: true })
    .createParents,
  true,
);
for (const bad of [
  { from: "a", to: "/b" },
  { from: "/a", to: "b" },
  { from: "/a", to: "/b\0" },
  { from: "/a" },
  { from: "/a", to: "/b", extra: 1 },
])
  assert.equal(moveInputSchema.safeParse(bad).success, false);
assert.deepEqual(moveOutputSchema.parse({ from: "/a", to: "/b" }), {
  from: "/a",
  to: "/b",
});
const move = computerCapabilities().find((tool) => tool.id === "move");
assert.equal(move?.kind, "fileStore");
assert.deepEqual(move?.parameters.required, ["from", "to"]);
const refusal = new ComputerFileMoveError("exists", "already exists: /b");
assert.equal(refusal.reason, "exists");
assert.match(refusal.message, /already exists/);
console.log("PASS the files.move contract");
