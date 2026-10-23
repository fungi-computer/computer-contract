# Computer Contract (`@fungi.computer/computer-contract`)

The wire contract for one Fungi Computer: the Zod schemas and types for
operation discovery, files, commands, processes and ports, shared by every host
and client that talks to a Computer. It has no runtime of its own and does not
depend on [`@fungi.computer/computer`](../computer/README.md), so an App or a
client can decode Computer operations without pulling in the Computer host.

## Install or set up

```sh
pnpm add @fungi.computer/computer-contract
```

The package is ESM-only and has one entrypoint. It depends on
`@fungi.computer/cairn` for request identifiers, `@fungi.computer/knapsack` for
the shared file-patch schemas, and `zod`.

## Quick start

```ts
import {
  pathSchema,
  mintComputerRequestId,
} from "@fungi.computer/computer-contract";

const path = pathSchema.parse("/workspace/notes.md");
const requestId = mintComputerRequestId();
```

## Core concepts

- **Operation schemas** describe each Computer operation's input and output:
  files (read, write, replace, list, patch, mkdir), command execution, processes
  and ports. A host decodes requests with them; a client decodes results with
  them.
- **Request identifiers** name one admitted operation, so repeating a request
  reads the same operation instead of running it again.
- **Backend ids** name the attached execution backend an operation ran on.

## API reference

The generated reference is in [docs/api](docs/api/README.md).

## Examples and checks

- `pnpm --filter @fungi.computer/computer-contract test` checks the reserved
  port and port-input rules.
- `pnpm --filter @fungi.computer/computer-contract stranger` packs the package
  and typechecks and runs a consumer against the tarball.

## Limits and errors

Every schema is bounded: paths, payload sizes and list lengths have explicit
limits, and a value outside them fails to decode with a Zod error. The package
performs no I/O.

## Contribute and license

Changes land through the Botanical repository. MIT licensed; see
[LICENSE](LICENSE).
