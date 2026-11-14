/* global console */
import assert from "node:assert/strict";
import {
  agentCodeExecutionTimeoutMs,
  ComputerCommandTooLongError,
  commandTooLongMessage,
  parseComputerExecInput,
  computerCapabilities,
  execInputSchema,
  maximumExecutionTimeMs,
  maximumProcessWaitMs,
  processWaitInputSchema,
} from "../dist/index.js";

const minute = 60_000;
const command = { command: "make" };

// A synchronous command may run for up to ten minutes.
assert.equal(maximumExecutionTimeMs, 10 * minute);
assert.equal(
  execInputSchema.parse({ ...command, timeoutMs: 9 * minute }).timeoutMs,
  9 * minute,
);
assert.equal(
  execInputSchema.parse({ ...command, timeoutMs: 10 * minute }).timeoutMs,
  10 * minute,
);

// Eleven minutes is refused, and the refusal names the limit and the way out.
const refused = execInputSchema.safeParse({
  ...command,
  timeoutMs: 11 * minute,
});
assert.equal(refused.success, false);
const sentence =
  "A command can run for up to 10 minutes. For longer work, start it in the background with start_process and check on it with wait_process.";
assert.equal(refused.error.issues[0].message, sentence);
assert.equal(commandTooLongMessage({ maximumTimeMs: 600_000 }), sentence);
// The typed boundary: a timeout past the bound is one named error; the
// advertised schema states the bound but does not itself refuse.
assert.throws(
  () => parseComputerExecInput({ ...command, timeoutMs: 11 * minute }),
  (error) =>
    error instanceof ComputerCommandTooLongError && error.message === sentence,
);
assert.equal(
  parseComputerExecInput({ ...command, timeoutMs: 9 * minute }).timeoutMs,
  9 * minute,
);
// Another budget names its own bound in its own units.
assert.match(
  commandTooLongMessage({ maximumTimeMs: 45_000 }),
  /^A command can run for up to 45 seconds\./,
);
// Other violations stay the schema's own error.
assert.throws(
  () => parseComputerExecInput({ ...command, timeoutMs: 0 }),
  (error) => !(error instanceof ComputerCommandTooLongError),
);
const advertised = computerCapabilities().find(({ name }) => name === "bash");
assert.ok(
  advertised.parameters.properties.timeoutMs.maximum > maximumExecutionTimeMs,
  "the advertised schema describes the bound; it does not refuse by it",
);
assert.match(advertised.parameters.properties.timeoutMs.description, /600000/);

// An Agent's execute run outlasts one such command.
assert.ok(agentCodeExecutionTimeoutMs > maximumExecutionTimeMs);

// Waiting on a background process is bounded and defaults to thirty seconds.
const id = "computer_process_" + "0".repeat(20);
assert.equal(maximumProcessWaitMs, maximumExecutionTimeMs);
assert.equal(
  processWaitInputSchema.safeParse({ id, timeoutMs: maximumProcessWaitMs + 1 })
    .success,
  false,
);

// Agents see the detached-process tools.
const names = computerCapabilities().map(({ name }) => name);
for (const name of [
  "start_process",
  "process_logs",
  "wait_process",
  "kill_process",
  "list_processes",
])
  assert.ok(names.includes(name), name);

console.log("execution bounds ok");
