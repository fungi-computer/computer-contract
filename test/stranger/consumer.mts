import {
  pathSchema,
  type ComputerValue,
} from "@fungi.computer/computer-contract";

const path: string = pathSchema.parse("/workspace/notes.md");
const value: ComputerValue | undefined = undefined;
console.log(path, value);
