import {
  pathSchema,
  mintComputerRequestId,
} from "@fungi.computer/computer-contract";

const path = pathSchema.parse("/workspace/notes.md");
console.log(path); // /workspace/notes.md
console.log(mintComputerRequestId().length > 0); // true
