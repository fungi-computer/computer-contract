import assert from "node:assert/strict";
import console from "node:console";
import {
  ComputerFileRemoveError,
  computerCapabilities,
  computerOperationSchema,
  removeInputSchema,
  removeOutputSchema,
} from "../dist/index.js";

assert.equal(computerOperationSchema.parse("files.remove"), "files.remove");
assert.deepEqual(removeInputSchema.parse({ path: "/a.png" }), {
  path: "/a.png",
});
for (const bad of [
  { path: "a.png" },
  { path: "/a\0" },
  { path: "" },
  {},
  { path: "/a", recursive: true },
])
  assert.equal(removeInputSchema.safeParse(bad).success, false);
assert.deepEqual(removeOutputSchema.parse({ path: "/a.png" }), {
  path: "/a.png",
});
// Deleting is for Media destinations only; no model is offered a delete tool.
assert.equal(
  computerCapabilities().some((tool) => tool.id === "remove"),
  false,
);
const refusal = new ComputerFileRemoveError("invalid", "a directory");
assert.equal(refusal.reason, "invalid");
assert.match(refusal.message, /a directory/);
console.log("PASS the files.remove contract");
