import assert from "node:assert/strict";
import console from "node:console";
import {
  computerCapabilities,
  computerServiceCapabilities,
  computerServiceViewSchema,
  serviceLogsInputSchema,
  serviceLogsOutputSchema,
  serviceNameInputSchema,
  ComputerServiceLimitError,
  ComputerServiceNotFoundError,
  computerServiceDeclarationSchema,
  computerServiceSchema,
  maximumComputerServices,
} from "../dist/index.js";

assert.equal(maximumComputerServices, 16);
const declaration = { name: "web", command: "node server.js" };
assert.deepEqual(
  computerServiceDeclarationSchema.parse({
    ...declaration,
    cwd: "/workspace/app",
    port: 8080,
    env: { NODE_ENV: "production", _X1: "plain value" },
  }),
  {
    ...declaration,
    cwd: "/workspace/app",
    port: 8080,
    env: { NODE_ENV: "production", _X1: "plain value" },
  },
);
// Names are lower-case labels, at most 32 characters, unique by name.
for (const name of [
  "",
  "Web",
  "1web",
  "web_x",
  "a".repeat(33),
  "web.x",
  "-web",
])
  assert.equal(
    computerServiceDeclarationSchema.safeParse({ ...declaration, name })
      .success,
    false,
    `name ${name}`,
  );
assert.equal(
  computerServiceDeclarationSchema.safeParse({
    ...declaration,
    name: "a".repeat(32),
  }).success,
  true,
);
// The grammar is closed and bounded: no unknown keys, no secret refs, no huge env.
for (const bad of [
  { ...declaration, enabled: true },
  { ...declaration, command: "" },
  { ...declaration, cwd: "relative" },
  { ...declaration, port: 0 },
  { ...declaration, port: 65536 },
  { ...declaration, env: { "BAD-NAME": "x" } },
  { ...declaration, env: { "1BAD": "x" } },
  { ...declaration, env: { OK: "x".repeat(4097) } },
  {
    ...declaration,
    env: Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`K${String(index)}`, "v"]),
    ),
  },
])
  assert.equal(
    computerServiceDeclarationSchema.safeParse(bad).success,
    false,
    JSON.stringify(bad).slice(0, 80),
  );
// A stored service adds who declared it, when, its revision and whether it runs.
assert.equal(
  computerServiceSchema.safeParse({
    ...declaration,
    enabled: true,
    declaredBy: "owner:member-a",
    declaredAt: 1,
    revision: 1,
  }).success,
  true,
);
assert.equal(
  computerServiceSchema.safeParse({ ...declaration, enabled: true }).success,
  false,
);
assert.equal(new ComputerServiceLimitError().name, "ComputerServiceLimitError");
assert.match(new ComputerServiceLimitError().message, /at most 16 services/);
assert.equal(
  new ComputerServiceNotFoundError("web").name,
  "ComputerServiceNotFoundError",
);
// The Agent tools: seven named operations over one closed grammar. They are
// not in computerCapabilities(): a host advertises them only when it serves them.
const tools = computerServiceCapabilities();
assert.deepEqual(
  tools.map(({ id }) => id),
  [
    "declare_service",
    "list_services",
    "service_logs",
    "stop_service",
    "start_service",
    "restart_service",
    "remove_service",
  ],
);
for (const tool of tools) {
  assert.equal(tool.kind, "runtime");
  assert.equal(tool.name, tool.id);
  assert.ok(tool.description.length > 40, tool.id);
  assert.equal(tool.parameters.type, "object");
}
assert.deepEqual(
  computerCapabilities().filter(
    ({ id }) => id.endsWith("_service") || id === "list_services",
  ),
  [],
);
const declare = tools[0];
assert.deepEqual(Object.keys(declare.parameters.properties).sort(), [
  "command",
  "cwd",
  "env",
  "name",
  "port",
]);
assert.deepEqual(declare.parameters.required, ["name", "command"]);
assert.equal(
  serviceNameInputSchema.safeParse({ name: "web", x: 1 }).success,
  false,
);
assert.equal(
  serviceLogsInputSchema.safeParse({ name: "web", lines: 200 }).success,
  true,
);
assert.equal(
  serviceLogsInputSchema.safeParse({ name: "web", lines: 201 }).success,
  false,
);
assert.equal(
  serviceLogsInputSchema.safeParse({ name: "web", lines: 0 }).success,
  false,
);
assert.equal(
  serviceLogsOutputSchema.safeParse({
    name: "web",
    lines: ["a"],
    truncated: false,
  }).success,
  true,
);
// A listed service carries its live status, which is never stored.
const view = {
  ...declaration,
  enabled: true,
  declaredBy: "agent:a",
  declaredAt: 1,
  revision: 1,
};
for (const status of [
  { state: "up", pid: 5, seconds: 3 },
  { state: "restarting", seconds: 0 },
  { state: "down" },
  { state: "asleep" },
])
  assert.equal(
    computerServiceViewSchema.safeParse({ ...view, status }).success,
    true,
  );
assert.equal(
  computerServiceViewSchema.safeParse({ ...view, status: { state: "weird" } })
    .success,
  false,
);
assert.equal(computerServiceViewSchema.safeParse(view).success, false);
console.log(JSON.stringify({ proof: "computer-services-contract", ok: true }));
