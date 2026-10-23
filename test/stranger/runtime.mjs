import assert from "node:assert/strict";
import {
  pathSchema,
  mintComputerRequestId,
} from "@fungi.computer/computer-contract";

assert.equal(pathSchema.parse("/workspace/notes.md"), "/workspace/notes.md");
assert.ok(mintComputerRequestId().length > 0);
