import { replayKey, defineIdFamily } from "@fungi.computer/cairn";
import * as z from "zod";

/**
 * The stable Workspace id of one attached execution backend: `container`,
 * `vm-` followed by a lowercase letter-or-digit name that may contain hyphens,
 * or `local-` followed by 16 lowercase base32 characters. A command request
 * names one to run there; omitted, the Computer routes by its default order.
 */
export const attachedBackendIdSchema = z.lazy(() =>
  z
    .string()
    .regex(/^(container|vm-[a-z0-9][a-z0-9-]{0,62}|local-[a-z2-7]{16})$/),
);

const utf8 = new TextEncoder();

/**
 * Most bytes of file content one Computer read or write carries, counted as
 * UTF-8.
 */
export const maximumFileBytes = 128 * 1_024;
/** Most entries one list, glob or grep reply returns in a single page. */
export const maximumListEntries = 256;
/** Longest glob or search pattern a request may send. */
export const maximumPatternCharacters = 512;
/** Longest command string a request may send. */
export const maximumCommandCharacters = 16 * 1_024;
/**
 * Most bytes of stdout or stderr kept from one command. A longer stream is cut
 * and marked.
 */
export const maximumStreamBytes = 64 * 1_024;
/** Room inside the stream cap for the visible truncation marker. */
export const truncationMarkerReserveBytes = 256;
/** The bound for ordinary Computer commands; hosts own any admitted job budget. */
export const maximumExecutionTimeMs = 120_000;

/** Host-owned policy, never supplied in a Computer request body. */
export type ComputerExecutionBudget = Readonly<{
  /** Longest time, in milliseconds, a command may be asked to run. */
  maximumTimeMs: number;
}>;
/**
 * The budget for ordinary Computer commands. Hosts that admit a job principal
 * choose their own.
 */
export const genericComputerExecutionBudget: ComputerExecutionBudget =
  Object.freeze({ maximumTimeMs: maximumExecutionTimeMs });

/**
 * Accepts any JSON value. Capability descriptions and other transport data are
 * checked against it.
 */
export const computerValueSchema = z.json();
/** A JSON value accepted by `computerValueSchema`. */
export type ComputerValue = z.output<typeof computerValueSchema>;

/**
 * Accepts the name of one Computer operation: a letter, then letters, digits or
 * underscores.
 */
export const capabilityNameSchema = z.lazy(() =>
  z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
);

/** One valid TCP port number, used only with this Computer's container. */
export const computerPortSchema = z.lazy(() =>
  z.number().int().min(1).max(65_535),
);
/** Most preview ports one Computer admits at once. */
export const maximumExposedPorts = 64;
/** computerd's Workspace RPC port, pinned by the Cloudflare container backend. */
export const computerDaemonPort = 8080;
/** The Computer-owned terminal server inside the container image. */
export const computerTerminalPort = 7681;
/**
 * Ports served by the Computer's own in-container daemons. An admitted
 * preview must never reach a control plane.
 */
export const computerReservedPorts: ReadonlySet<number> = new Set([
  computerDaemonPort,
  computerTerminalPort,
]);
/**
 * Whether a Computer daemon owns this port, so it can never be admitted for
 * preview.
 */
export function isComputerReservedPort(port: number): boolean {
  return computerReservedPorts.has(port);
}
/** Names one container port to expose or remove. */
export const computerPortInputSchema = z.strictObject({
  /** The container port to act on. */
  port: computerPortSchema,
});
/** Reply to a request to expose a port. */
export const computerPortOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The container port that was requested. */
    port: computerPortSchema,
    /** Whether the port is now admitted for preview. */
    exposed: z.boolean(),
  }),
);
/** Reply to a request to stop exposing a port. */
export const computerPortRemovalOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The container port that was requested. */
    port: computerPortSchema,
    /** Whether the port had been admitted and is now removed. */
    removed: z.boolean(),
  }),
);
/** The ports this Computer currently admits for preview. */
export const computerPortsOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The admitted ports, at most `maximumExposedPorts`. */
    ports: z.array(computerPortSchema).max(maximumExposedPorts),
  }),
);

/** The port belongs to a Computer daemon and cannot be admitted for preview. */
export class ComputerPortReservedError extends Error {
  constructor(port: number) {
    super(`Computer port ${String(port)} is reserved`);
    this.name = "ComputerPortReservedError";
  }
}

/** A requested port cannot be reserved; no other process identity is disclosed. */
export class ComputerPortConflictError extends Error {
  constructor() {
    super("Computer port is unavailable");
    this.name = "ComputerPortConflictError";
  }
}

/** This Computer already admits the maximum number of preview ports. */
export class ComputerPortLimitError extends Error {
  constructor() {
    super(`Computer can expose at most ${String(maximumExposedPorts)} ports`);
    this.name = "ComputerPortLimitError";
  }
}

// Schema keywords are opaque transport data. Zod still validates every value
// as JSON before the description leaves or enters the Computer boundary.
const schemaDocument = z.lazy(() =>
  z
    .record(z.string(), z.unknown())
    .refine(
      (value) => computerValueSchema.safeParse(value).success,
      "Capability schema must contain JSON values",
    ),
);

/** Native operation descriptions shared by discovery and its OpenAPI document. */
export const computerCapabilitiesSchema = z.lazy(() =>
  z.array(
    z.strictObject({
      /** Identifier of the operation. */
      id: capabilityNameSchema,
      /** Name of the operation. It equals the identifier. */
      name: capabilityNameSchema,
      /** Family the operation belongs to, such as file storage or runtime. */
      kind: z.string(),
      /** What the operation does, in words a model or reader can act on. */
      description: z.string(),
      /** JSON Schema describing the operation's input. */
      parameters: schemaDocument,
      /** JSON Schema describing the operation's result. */
      output: schemaDocument,
    }),
  ),
);

/**
 * Accepts an absolute path inside the Computer: it starts with a slash and
 * holds no null byte.
 */
export const pathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .startsWith("/")
  .refine((path) => !path.includes("\0"), "Path cannot contain null bytes");

/**
 * Builds a schema for text of at least the given length whose UTF-8 size stays
 * within `maximumFileBytes`.
 */
export const boundedTextSchema = (minimumLength = 0) =>
  z
    .string()
    .min(minimumLength)
    .refine(
      (content) => utf8.encode(content).byteLength <= maximumFileBytes,
      `Text exceeds the ${String(maximumFileBytes)}-byte Computer bound`,
    );

/** Complete bounded UTF-8 text reads. Binary reads use the same path input. */
export const readInputSchema = z.strictObject({
  /** The file to read. */
  path: pathSchema,
});
/** A request to read one whole file as text. */
export type ComputerFileReadInput = z.output<typeof readInputSchema>;
/** The whole contents of one file, as text. */
export const readOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The file that was read. */
    path: pathSchema,
    /** The file's text. */
    content: boundedTextSchema(),
  }),
);
/** The reply to reading one whole file as text. */
export type ComputerFileReadOutput = z.output<typeof readOutputSchema>;
/** Optional byte window; text reads remain complete and independently bounded. */
export const readBytesInputSchema = z.strictObject({
  /** The file to read. */
  path: pathSchema,
  /** First byte of the window. Omitted, the window starts at the beginning. */
  byteOffset: z.number().int().nonnegative().optional(),
  /**
   * Size of the window in bytes, at most `maximumFileBytes`. Omitted, the read
   * runs to that bound.
   */
  byteLength: z.number().int().positive().max(maximumFileBytes).optional(),
});
/** A request to read a window of bytes from one file. */
export type ComputerFileByteReadInput = z.output<typeof readBytesInputSchema>;

/** Finite byte-read reply used by admitted App frame bindings. */
export const computerByteReadReplySchema = z.lazy(() =>
  z.strictObject({
    /** The file that was read. */
    path: readBytesInputSchema.shape.path,
    /** Byte at which the returned window starts. */
    byteOffset: z.number().int().nonnegative(),
    /** The window's bytes, base64 encoded. */
    content: z.string(),
    /** How `content` is encoded. Always base64. */
    encoding: z.literal("base64"),
    /** Whether the file continues past the returned window. */
    truncated: z.boolean(),
  }),
);

/** Host-admitted App method preview; parsing does not grant port access. */
export const appMethodPreviewResultSchema = z.lazy(() =>
  z.strictObject({
    /** Address where the exposed port's preview can be opened. */
    previewUrl: z.url(),
    /** When the preview address stops being valid. */
    expiresAt: z.number().int().positive(),
  }),
);

/**
 * Accepts how many entries a list returns: 1 up to `maximumListEntries`, 100
 * when omitted.
 */
export const listLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(maximumListEntries)
  .default(100);
/** Accepts how many entries a list skips. Zero when omitted. */
export const listOffsetSchema = z.number().int().nonnegative().default(0);
/** A request for one page of a directory's entries. */
export const listInputSchema = z.strictObject({
  /** The directory to list. The root when omitted. */
  path: pathSchema.default("/"),
  /** Most entries to return in this page. */
  limit: listLimitSchema,
  /** Entries to skip before this page. */
  offset: listOffsetSchema,
});
const listEntrySchema = z.lazy(() =>
  z.strictObject({
    /** The entry's name inside its directory. */
    name: z.string(),
    /** The entry's size in bytes. */
    size: z.number().int().nonnegative(),
    /** When the entry last changed, as the Computer's file store reports it. */
    modifiedAt: z.number(),
    /** Whether the entry is a file, a directory or a symbolic link. */
    type: z.enum({
      /** A regular file. */
      file: "file",
      /** A directory. */
      directory: "directory",
      /** A symbolic link. */
      symlink: "symlink",
    }),
  }),
);
/** One page of a directory's entries. */
export const listOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The directory that was listed. */
    path: pathSchema,
    /** The entries in this page. */
    entries: z.array(listEntrySchema).max(maximumListEntries),
    /** Offset to request for the next page, or null when this was the last. */
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
);
/** A request for one page of a directory's entries. */
export type ComputerFileListInput = z.output<typeof listInputSchema>;
/** The reply to a directory listing. */
export type ComputerFileListOutput = z.output<typeof listOutputSchema>;

/** Accepts text to store in a file, within `maximumFileBytes`. */
export const fileContentSchema = z.lazy(() =>
  z
    .string()
    .refine(
      (content) => utf8.encode(content).byteLength <= maximumFileBytes,
      "File exceeds the Computer write bound",
    ),
);
/** A request to write one file, creating or replacing its contents. */
export const writeInputSchema = z.strictObject({
  /** The file to write. */
  path: pathSchema,
  /** The text to store. */
  content: fileContentSchema,
});
/** The reply to a committed file write. */
export const writeOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The file that was written. */
    path: pathSchema,
    /** Size of the stored content in bytes. */
    bytes: z.number().int().nonnegative(),
  }),
);
/** A request to write one file. */
export type ComputerFileWriteInput = z.output<typeof writeInputSchema>;
/** The reply to a committed file write. */
export type ComputerFileWriteOutput = z.output<typeof writeOutputSchema>;
/** Names the file for a binary write. The bytes travel as the request body. */
export const writeBytesInputSchema = readInputSchema;

/**
 * A request to replace a file's contents only if they still equal what the
 * caller last saw.
 */
export const replaceInputSchema = z.strictObject({
  /** The file to replace. */
  path: pathSchema,
  /**
   * The contents the caller last saw. A mismatch raises `ComputerFileConflict`.
   */
  expectedContent: fileContentSchema,
  /** The contents to store. */
  content: fileContentSchema,
});
/** The reply to a committed replacement. It has the shape of a write reply. */
export const replaceOutputSchema = writeOutputSchema;

/** A request to find paths under a directory that match a glob. */
export const globInputSchema = z.lazy(() =>
  z.strictObject({
    /** The directory to search under. */
    path: pathSchema,
    /** The glob that paths must match. */
    pattern: z.string().min(1).max(maximumPatternCharacters),
    /** Most matches to return. */
    limit: z
      .number()
      .int()
      .min(1)
      .max(maximumListEntries)
      .default(maximumListEntries),
  }),
);
/** The paths a glob found. */
export const globOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The directory that was searched. */
    path: pathSchema,
    /** The matching paths. */
    matches: z.array(pathSchema).max(maximumListEntries),
    /** Whether more paths matched than were returned. */
    truncated: z.boolean(),
  }),
);

/** A request to search file contents under a directory. */
export const grepInputSchema = z.lazy(() =>
  z.strictObject({
    /** The directory to search under. */
    path: pathSchema,
    /** The text to look for, or a regular expression when `regex` is true. */
    pattern: z.string().min(1).max(maximumPatternCharacters),
    /** Whether `pattern` is a regular expression. False when omitted. */
    regex: z.boolean().default(false),
    /** Whether letter case is ignored. False when omitted. */
    ignoreCase: z.boolean().default(false),
    /** Glob, relative to `path`, that limits which files are searched. */
    include: z.string().min(1).max(maximumPatternCharacters).optional(),
    /** Most matching lines to return. */
    limit: z
      .number()
      .int()
      .min(1)
      .max(maximumListEntries)
      .default(maximumListEntries),
  }),
);
/** The lines a search found. */
export const grepOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The directory that was searched. */
    path: pathSchema,
    /** The matching lines. */
    matches: z
      .array(
        z.strictObject({
          /** The file that holds the match. */
          path: pathSchema,
          /** The match's line number, counting from 1. */
          line: z.number().int().positive(),
          /** The text of the matching line. */
          text: z.string(),
        }),
      )
      .max(maximumListEntries),
    /** Whether more lines matched than were returned. */
    truncated: z.boolean(),
  }),
);

/** A request to find paths that match a glob. */
export type ComputerFileGlobInput = z.output<typeof globInputSchema>;
/** A request to search file contents. */
export type ComputerFileGrepInput = z.output<typeof grepInputSchema>;

/** A request to replace one piece of text in a file. */
export const editInputSchema = z.lazy(() =>
  z.strictObject({
    /** The file to edit. */
    path: pathSchema,
    /** The text to replace. It cannot be empty. */
    oldText: boundedTextSchema(1),
    /** The text to put in its place. */
    newText: boundedTextSchema(),
  }),
);
/** The reply to a committed edit. */
export const editOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The file that was edited. */
    path: pathSchema,
    /** Size of the file's content after the edit, in bytes. */
    bytes: z.number().int().nonnegative(),
    /** A readable diff of the change. */
    diff: z.string(),
    /**
     * Line number of the first change in the new text, or null when nothing
     * changed.
     */
    firstChangedLine: z.number().int().positive().nullable(),
  }),
);

// Native Files tools and Computer HTTP decode the same patch contract.
export {
  patchInputSchema,
  patchOutputSchema,
} from "@fungi.computer/knapsack/files-patch";

/** A request to create a directory. */
export const mkdirInputSchema = z.lazy(() =>
  z.strictObject({
    /** The directory to create. */
    path: pathSchema,
    /**
     * Whether missing parent directories are created too. True when omitted.
     */
    recursive: z.boolean().default(true),
  }),
);
/** The reply to a directory creation. */
export const mkdirOutputSchema = z.strictObject({
  /** The directory that was created. */
  path: pathSchema,
});

/**
 * Host-owned idempotency key for one `exec` or `bash` tool invocation. The
 * host mints it once per invocation and keeps it across its own retries of that
 * invocation; the model never sees or supplies it.
 */
export const computerRequestIdSchema = z.uuid({ version: "v7" });
/** A request id that passed `computerRequestIdSchema`. */
export type ComputerRequestId = z.output<typeof computerRequestIdSchema>;

/** Mint the request ID for one host tool invocation. */
export function mintComputerRequestId(): ComputerRequestId {
  return computerRequestIdSchema.parse(replayKey());
}

/** Model-facing command input. It carries no request identity. */
function executionInputSchema(budget: ComputerExecutionBudget) {
  return z.strictObject({
    /** The shell command to run. */
    command: z.string().min(1).max(maximumCommandCharacters),
    /** The directory to run in. The Computer's default when omitted. */
    cwd: pathSchema.optional(),
    /** An attached backend id; omitted routes by the Computer's default order. */
    backend: attachedBackendIdSchema.optional(),
    /**
     * How long the command may run, in milliseconds. Ten seconds when omitted.
     */
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(budget.maximumTimeMs)
      .default(10_000),
  });
}
/**
 * The model's command input: command, directory, backend and timeout. It
 * carries no request id.
 */
export const execInputSchema = executionInputSchema(
  genericComputerExecutionBudget,
);

/** Resource hosts select a budget only after admitting their job principal. */
export function computerExecutionRequestSchema(
  budget: ComputerExecutionBudget,
) {
  return executionInputSchema(budget).extend({
    /** The host's id for this invocation, kept across its own retries. */
    requestId: computerRequestIdSchema,
  });
}
/** Host-to-Computer command request: the model input plus the host's ID. */
export const execRequestSchema = execInputSchema.extend({
  /** The host's id for this invocation, kept across its own retries. */
  requestId: computerRequestIdSchema,
});
/** One command stream cut at `maximumStreamBytes`; absent streams were whole. */
export const execTruncationSchema = z.strictObject({
  /** Which stream was cut. */
  stream: z.enum({
    /** The command's standard output. */
    stdout: "stdout",
    /** The command's standard error. */
    stderr: "stderr",
  }),
  /** Bytes of the stream that were kept. */
  keptBytes: z.number().int().nonnegative(),
  /** Bytes the stream held before it was cut. */
  totalBytes: z.number().int().positive(),
});
const marker = (stream: string, kept: number, total: number) => {
  const kib = (bytes: number) => `${(bytes / 1_024).toFixed(1)} KiB`;
  return `[fungi: ${stream} truncated: ${kib(kept)} of ${kib(total)} shown; redirect to a file or use head/tail]`;
};
/** The visible line appended to a cut stream; sizes exclude the line itself. */
export function execTruncationMarker(entry: ComputerExecTruncation) {
  return `\n${marker(entry.stream, entry.keptBytes, entry.totalBytes)}`;
}
/** Matches the marker line `execTruncationMarker` appends at the end of a stream. */
export const execTruncationMarkerPattern =
  /\n\[fungi: (?:stdout|stderr) truncated: [^\]]*\]$/u;
/** Longest prefix of `bytes` within `limit` that ends on a UTF-8 character boundary. */
export function utf8Prefix(bytes: Uint8Array, limit: number) {
  let end = Math.min(limit, bytes.byteLength);
  while (
    end > 0 &&
    end < bytes.byteLength &&
    ((bytes[end] ?? 0) & 0xc0) === 0x80
  )
    end -= 1;
  return bytes.slice(0, end);
}
/** A record that one command stream was cut. */
export type ComputerExecTruncation = z.output<typeof execTruncationSchema>;
/** What a finished command left behind. */
export const execOutputSchema = z.strictObject({
  /** How the command ended: completed, failed or cancelled. */
  status: z.enum({
    /** The command exited with code 0. */
    completed: "completed",
    /** The command exited with a nonzero code that is not a cancellation. */
    failed: "failed",
    /** The command was cancelled. */
    cancelled: "cancelled",
  }),
  /** The command's exit code. */
  exitCode: z.number().int(),
  /** The captured standard output, cut at `maximumStreamBytes`. */
  stdout: z.string(),
  /** The captured standard error, cut at `maximumStreamBytes`. */
  stderr: z.string(),
  /** `false` when both streams are whole, else one entry per cut stream. */
  truncated: z.union([z.literal(false), z.array(execTruncationSchema).min(1)]),
});
/** One long-running container process owned by this Computer. */
const processIds = defineIdFamily({
  family: "computer-process",
  version: 1,
  kinds: { process: { prefix: "computer_process" } },
}).process;
/** Accepts the durable id of one started process. */
export const computerProcessIdSchema = z.lazy(() =>
  z.string().refine((value) => processIds.is(value)),
);
/** A process id that passed `computerProcessIdSchema`. */
export type ComputerProcessId = z.output<typeof computerProcessIdSchema>;
/** At most this many processes may be running in one host scope at once. */
export const maximumRunningProcesses = 16;
/** At most this many process records, running or exited, are kept per host scope. */
export const maximumProcessRecords = 64;

/** Mint the durable identity of one started process. */
export function mintComputerProcessId(): ComputerProcessId {
  return processIds.generate();
}

/** The host's request to start one long-running process. */
export const processStartInputSchema = z.strictObject({
  /**
   * The host's replay key. Repeating it within the same scope names the same
   * process.
   */
  requestId: z.string().min(1).max(256),
  /**
   * The authority the request id belongs to, so ids from different callers do
   * not collide.
   */
  requestScope: z.string().min(1).max(512),
  /**
   * Container port the process serves. It is admitted for preview when given.
   */
  port: computerPortSchema.optional(),
  /** The shell command to run. */
  command: z.string().min(1).max(maximumCommandCharacters),
  /** The directory to run in. The Computer's default when omitted. */
  cwd: pathSchema.optional(),
});
/** Model input excludes the host's replay identity and authority scope. */
export const processStartToolInputSchema = processStartInputSchema.omit({
  requestId: true,
  requestScope: true,
});

/** A trusted App host binds replay identity to its admitted installation and caller. */
export function installationProcessScope(
  installation: string,
  method: string,
  actor: Readonly<{ kind: "member" | "agent" | "team-key"; id: string }>,
): string {
  return processStartInputSchema.shape.requestScope.parse(
    `installation:${JSON.stringify([installation, method, `${actor.kind}:${actor.id}`])}`,
  );
}

/** Names one started process. */
export const processIdInputSchema = z.strictObject({
  /** The process to act on. */
  id: computerProcessIdSchema,
});
/**
 * `running`: computerd still reports the execution live. `exited`: it ended;
 * `exitCode` is null when the runtime that ran it was replaced or its record
 * expired before the exit code was observed. `uncertain`: the Computer could
 * not reach its container to check, so neither is claimed.
 */
export const computerProcessStateSchema = z.enum({
  /** computerd still reports the execution live. */
  running: "running",
  /** The execution ended. */
  exited: "exited",
  /** The Computer could not reach its container to check. */
  uncertain: "uncertain",
});
/**
 * `synced`: the drain that recorded this exit read all the way to EOF,
 * which is also the read that runs computerd's post-command pull.
 * `pending`: that drain gave up waiting at its own deadline (a
 * backgrounded child, for example `node server.js &`, can hold the
 * transport open long after its parent exits) -- a background
 * continuation keeps watching and upgrades this row to `synced` once it
 * reaches that real EOF, so `pending` rows stay updatable. `unknown`:
 * this exit was recorded with no pull evidence at all (a replaced
 * runtime, an expired record, or any other exit path that never drained
 * for one). Never claim `synced` without the specific evidence for this
 * exit; default to `unknown`, not `synced`.
 */
export const computerProcessSyncSchema = z.enum({
  /** The drain that recorded the exit read to the end of the stream. */
  synced: "synced",
  /** The drain gave up at its deadline. A background watcher upgrades it to synced. */
  pending: "pending",
  /** The exit was recorded with no pull evidence. */
  unknown: "unknown",
});
/** A value of `computerProcessSyncSchema`. */
export type ComputerProcessSync = z.output<typeof computerProcessSyncSchema>;
/** One started process, as the Computer reports it. */
export const computerProcessSchema = z.strictObject({
  /** The process's durable id. */
  id: computerProcessIdSchema,
  /** The preview port the process serves, or null. */
  port: computerPortSchema.nullable(),
  /** The command the process runs. */
  command: z.string(),
  /** The directory it was started in, or null for the default. */
  cwd: z.string().nullable(),
  /** Whether the process is running, has exited or cannot be checked. */
  state: computerProcessStateSchema,
  /** Exit code, or null while running or when it was never observed. */
  exitCode: z.number().int().nullable(),
  /**
   * Whether the exit was recorded with evidence that the Computer's files were
   * synchronized.
   */
  sync: computerProcessSyncSchema,
  /** When the Computer recorded the process as started. */
  startedAt: z.number().int(),
  /** When the Computer recorded the process as ended, or null while it runs. */
  endedAt: z.number().int().nullable(),
});
/** One started process, as the Computer reports it. */
export type ComputerProcess = z.output<typeof computerProcessSchema>;
/** The processes started on this Computer. */
export const processListOutputSchema = z.strictObject({
  /** Process records, at most `maximumProcessRecords`. */
  processes: z.array(computerProcessSchema).max(maximumProcessRecords),
});
/** The reply to a request to stop a process. */
export const processKillOutputSchema = z.lazy(() =>
  z.strictObject({
    /** The process record after the request. */
    process: computerProcessSchema,
    /**
     * Whether a stop signal was sent. False when the process was not running or
     * could not be signalled.
     */
    signalled: z.boolean(),
  }),
);

/** No process with this id was started on this Computer. */
export class ComputerProcessNotFoundError extends Error {
  constructor(id: string) {
    super(`Computer process not found: ${id}`);
    this.name = "ComputerProcessNotFoundError";
  }
}

/** Every process slot is occupied by a running process. */
export class ComputerProcessLimitError extends Error {
  constructor() {
    super(
      `Computer process scope can run at most ${String(maximumRunningProcesses)} processes`,
    );
    this.name = "ComputerProcessLimitError";
  }
}
/** The model's command input. */
export type ComputerExecInput = z.output<typeof execInputSchema>;
/** The host's command request: the model's input plus the host's request id. */
export type ComputerExecRequest = z.output<typeof execRequestSchema>;
/** What a finished command left behind. */
export type ComputerExecOutput = z.output<typeof execOutputSchema>;

/** Host-memory-only native inputs. Never part of a tool, replay row or log. */
export type ComputerExecutionCarriage = Readonly<{
  /** Command-local environment supplied only to this actual native invocation. */
  env?: Readonly<Record<string, string>>;
  /** String or byte input supplied to the same native invocation's stdin. */
  stdin?: string | Uint8Array;
}>;

/** Non-secret identity of the actual native invocation, not its credential. */
export type ComputerExecutionInvocation = Readonly<{
  /** Stable public native identity, reused on replay without another dispatch. */
  id: string;
  /** The existing admission owner for this command or managed process. */
  kind: "exec" | "process";
}>;

/** Authority closure is distinct from asserting a native exit code. */
export type ComputerExecutionCloseReason =
  "refused_start" | "native_exit" | "unknown" | "reconstructed";

/**
 * The resource host owns cargo meaning and issuance. Computer owns NEW/replay,
 * dispatch and actual native liveness. Only non-secret context is durable;
 * hooks and carriage stay in host memory.
 */
export type ComputerExecutionHostHooks = Readonly<{
  /** Open host authority after NEW admission, immediately before native dispatch. */
  open(
    invocation: ComputerExecutionInvocation,
    context: ComputerValue,
  ): Promise<ComputerExecutionCarriage>;
  /** Renew from a caller observation only after actual native liveness is proven. */
  renew(
    invocation: ComputerExecutionInvocation,
    context: ComputerValue,
  ): Promise<void>;
  /** Release host authority after Computer durably records its closure reason. */
  close(
    invocation: ComputerExecutionInvocation,
    context: ComputerValue,
    reason: ComputerExecutionCloseReason,
  ): Promise<void>;
}>;

/** Protected host seam only. Public command/process parsers do not accept cargo. */
export type ComputerExecutionHostPort = Readonly<{
  /** The trusted host's in-memory hooks, absent when no such host is attached. */
  executionHooks(): ComputerExecutionHostHooks | undefined;
  /** Observe the selected native invocation without consuming its output reader. */
  executionIsLive(invocationId: string): Promise<boolean>;
  /** Admit a command with optional non-secret context supplied by the trusted host. */
  executeOperationAfterAcceptance(
    input: ComputerExecRequest,
    accept: () => void,
    kind: "exec" | "bash" | "hosted",
    budget?: ComputerExecutionBudget,
    signal?: AbortSignal,
    executionContext?: ComputerValue,
  ): Promise<ComputerOperationResult>;
  /** Admit or replay a managed process without accepting public credential cargo. */
  startProcessAfterAcceptance(
    input: ComputerValue,
    accept: () => void,
    executionContext?: ComputerValue,
  ): Promise<ComputerProcess>;
  /** Dispatch an ordinary capability while preserving the trusted host's context. */
  callAfterAcceptance(
    capabilityId: ComputerValue,
    input: ComputerValue,
    accept: () => void,
    executionContext?: ComputerValue,
  ): Promise<ComputerValue>;
}>;

/**
 * Where one command invocation stands: accepted, running, succeeded, failed,
 * unknown (the outcome cannot be established, because the Computer restarted
 * mid-command or the id has no record yet is still inside the admission
 * window) or expired (no record, and older than the admission window).
 */
export const computerOperationStatusSchema = z.enum({
  /** The request id is recorded and the command has not started. */
  accepted: "accepted",
  /** The command is running. */
  running: "running",
  /** The command completed. */
  succeeded: "succeeded",
  /** The command ended without completing. */
  failed: "failed",
  /**
   * The outcome cannot be established: the Computer restarted mid-command, or
   * the id has no record yet is still inside the admission window.
   */
  unknown: "unknown",
  /** The id has no record and is older than the admission window. */
  expired: "expired",
});
/** Durable operation status returned to the host that owns the request ID. */
export const computerOperationResultSchema = z.strictObject({
  /** The host's id for this invocation. */
  requestId: computerRequestIdSchema,
  /** Where the invocation stands. */
  status: computerOperationStatusSchema,
  /** The command's output once known and still retained, otherwise null. */
  output: execOutputSchema.nullable(),
});
/**
 * The durable status of one command invocation, for the host that owns its
 * request id.
 */
export type ComputerOperationResult = z.output<
  typeof computerOperationResultSchema
>;
/** Model-facing command result: the durable status without the host's ID. */
export const computerToolResultSchema = computerOperationResultSchema.omit({
  requestId: true,
});
/** The status of one command invocation without the host's request id. */
export type ComputerToolResult = z.output<typeof computerToolResultSchema>;

/** Project one host operation result onto the model-facing tool result. */
export function computerToolResult(
  result: ComputerOperationResult,
): ComputerToolResult {
  return computerToolResultSchema.parse({
    status: result.status,
    output: result.output,
  });
}

/** Public operation vocabulary; transport adapters map these to routes. */
export const computerOperationSchema = z.enum({
  /** Read one whole file as text. */
  "files.read": "files.read",
  /** Read a window of bytes from one file. */
  "files.readBytes": "files.readBytes",
  /** Write one file as text. */
  "files.write": "files.write",
  /** Write one file from binary bytes. */
  "files.writeBytes": "files.writeBytes",
  /** List one page of a directory. */
  "files.list": "files.list",
  /** Find paths that match a glob. */
  "files.glob": "files.glob",
  /** Search file contents. */
  "files.grep": "files.grep",
  /** Replace one piece of text in a file. */
  "files.edit": "files.edit",
  /** Apply a patch to files. */
  "files.patch": "files.patch",
  /** Create a directory. */
  mkdir: "mkdir",
  /** Run a command in the Computer's container. */
  bash: "bash",
  /** Run a command in the Computer's lightweight Worker shell. */
  exec: "exec",
});
/** One public operation name. */
export type ComputerOperation = z.output<typeof computerOperationSchema>;

/** A request to replace a file's contents if they still match. */
export type ComputerFileReplacement = z.output<typeof replaceInputSchema>;
/** The reply to a committed replacement. */
export type ComputerFileReplacementResult = z.output<
  typeof replaceOutputSchema
>;

/** The expected file contents no longer match at atomic replacement. */
export class ComputerFileConflict extends Error {
  constructor() {
    super("Files edit conflict: contents changed before replacement");
    this.name = "ComputerFileConflict";
  }
}

/** A byte window starts beyond the current file extent. */
export class ComputerFileRangeError extends Error {
  constructor(
    /** The file's current size in bytes. */
    readonly size: number,
  ) {
    super("Byte offset exceeds file size");
    this.name = "ComputerFileRangeError";
  }
}

/** The requested file bytes exceed the admitted read bound. */
export class ComputerFileTooLargeError extends Error {
  constructor() {
    super("File exceeds the Computer read bound");
    this.name = "ComputerFileTooLargeError";
  }
}

function capability(
  id: string,
  kind: string,
  description: string,
  input: z.ZodType,
  output: z.ZodType,
) {
  const parameters = structuredClone(z.toJSONSchema(input, { io: "input" }));
  const result = structuredClone(z.toJSONSchema(output));
  return computerValueSchema.parse({
    id,
    name: id,
    kind,
    description,
    parameters,
    output: result,
  });
}

let capabilities: z.output<typeof computerCapabilitiesSchema> | undefined;

/**
 * The operations every Computer advertises; static, so hosts can describe them
 * without a call. Built on first read: deriving JSON Schema for every operation
 * is real work that a Worker should not pay at startup.
 */
export function computerCapabilities(): z.output<
  typeof computerCapabilitiesSchema
> {
  capabilities ??= computerCapabilitiesSchema.parse([
    capability(
      "read",
      "fileStore",
      "Read one bounded UTF-8 file from this Computer.",
      readInputSchema,
      readOutputSchema,
    ),
    capability(
      "list",
      "fileStore",
      "List one bounded page of a directory on this Computer.",
      listInputSchema,
      listOutputSchema,
    ),
    capability(
      "mkdir",
      "fileStore",
      "Create a directory on this Computer.",
      mkdirInputSchema,
      mkdirOutputSchema,
    ),
    capability(
      "write",
      "fileStore",
      "Write one bounded UTF-8 file without creating its parent directory.",
      writeInputSchema,
      writeOutputSchema,
    ),
    capability(
      "bash",
      "runtime",
      "Run one bounded shell command in this Computer's Linux container, with node, npm and the programs installed there.",
      execInputSchema,
      computerToolResultSchema,
    ),
    capability(
      "exec",
      "runtime",
      "Run one bounded command in a lightweight Worker shell over this Computer's files. It has no node, npm or installed programs; use bash to run programs.",
      execInputSchema,
      computerToolResultSchema,
    ),
    capability(
      "start_process",
      "runtime",
      "Start one long-running command, such as a dev server, in this Computer's container. Returns its durable process id.",
      processStartToolInputSchema,
      computerProcessSchema,
    ),
    capability(
      "list_processes",
      "runtime",
      "List this Computer's started processes as running, exited or uncertain.",
      z.strictObject({}),
      processListOutputSchema,
    ),
    capability(
      "kill_process",
      "runtime",
      "Send SIGTERM to one running process on this Computer.",
      processIdInputSchema,
      processKillOutputSchema,
    ),
  ]);
  return capabilities;
}
