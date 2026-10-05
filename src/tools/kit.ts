/**
 * Shared plumbing every tool uses, now on Slipway.
 *
 * Tool modules keep describing themselves with a Zod shape, a risk and a
 * handler. This adapter turns each into a Slipway tool, so the MCP server, the
 * CLI, the write guard, annotations and errors all come from the framework
 * instead of a copy kept in this repo.
 */

import {
  ApiError,
  AuthError,
  NotFoundError as SlipwayNotFound,
  RateLimitError as SlipwayRateLimit,
  RefusedError,
  TimeoutError as SlipwayTimeout,
  toolkit,
  UsageError,
  z,
  type Risk,
  type SlipwayError,
  type Tool,
} from "@thenavidm/slipway";
import type { ThreadsClient } from "../api/client.js";
import {
  AuthenticationError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  TextTooLongError,
  ThreadsError,
  TimeoutError,
  ValidationError,
  WriteBlockedError,
} from "../api/errors.js";
import type { Account, Config } from "../config.js";
import { selectAccount } from "../config.js";

export type ToolContext = {
  client: ThreadsClient;
  config: Config;
  /** Resolve which profile this call acts as. */
  account: (hint?: string) => Account;
};

const kit = toolkit<ToolContext>();

/** The optional argument that picks a profile, on every account-scoped tool. */
export const accountArg = {
  account: z
    .string()
    .optional()
    .describe(
      "Which connected Threads profile to act as, by username (for example 'thenavidm'). Defaults to the first connected profile. Call list_accounts to see them.",
    ),
};

/**
 * Kept so tool modules read the same, but never sent: Slipway adds `confirm`
 * to every irreversible tool itself, with one description everywhere.
 */
export const confirmArg = {
  confirm: z.boolean().optional(),
};

/** Cursor and limit, on every paginating tool. */
export const pageArgs = {
  limit: z.number().int().min(1).max(100).optional().describe("How many to return, 1-100."),
  cursor: z
    .string()
    .optional()
    .describe("Continue from a previous page. Pass the `cursor` attribute from the last result."),
};

type Shape = Record<string, z.ZodType>;

export type ToolSpec<S extends Shape> = {
  name: string;
  /** One line, imperative. Shown in tool pickers. */
  title: string;
  description: string;
  schema: S;
  risk: Risk;
  /** True when calling twice has the same effect as calling once. */
  idempotent?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
  /** One line for the audit log and the confirm message, when this is a write. */
  summary?: (args: z.infer<z.ZodObject<S>>) => string;
};

export type AnyToolSpec = Tool<ToolContext>;

/**
 * Meta answers almost every failure with HTTP 400, an expired token and a
 * spent quota included, and puts what happened in `code` and `error_subcode`.
 * `api/errors.ts` already sorts them into classes, so the exit code and error
 * code follow the class, not the status, and Meta's own fields ride along in
 * `details` for the model to read.
 */
export function toSlipway(error: ThreadsError): SlipwayError {
  const details = Object.fromEntries(
    Object.entries({
      endpoint: error.endpoint,
      meta_code: error.code || undefined,
      meta_subcode: error.subcode || undefined,
      meta_type: error.type || undefined,
      detail: error.detail || undefined,
      trace_id: error.traceId || undefined,
    }).filter(([, value]) => value !== undefined),
  );
  const options = { ...(error.status ? { status: error.status } : {}), details, cause: error };
  if (error instanceof AuthenticationError || error instanceof PermissionError) return new AuthError(error.message, options);
  if (error instanceof NotFoundError) return new SlipwayNotFound(error.message, options);
  if (error instanceof RateLimitError) return new SlipwayRateLimit(error.message, options);
  if (error instanceof ValidationError || error instanceof TextTooLongError) return new UsageError(error.message, options);
  if (error instanceof WriteBlockedError) return new RefusedError(error.message, options);
  if (error instanceof TimeoutError) return new SlipwayTimeout(error.message, options);
  // A server error, a container that never finished processing, or no answer at all: the service's failure, worth a retry.
  return new ApiError(error.message, options);
}

export function defineTool<S extends Shape>(spec: ToolSpec<S>): Tool<ToolContext> {
  const { confirm: _confirm, ...shape } = spec.schema as Shape;
  const handler = spec.handler as (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  return kit.defineTool({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: z.object(shape),
    risk: spec.risk,
    ...(spec.idempotent !== undefined ? { idempotent: spec.idempotent } : {}),
    ...(spec.summary ? { summary: spec.summary as (args: Record<string, unknown>) => string } : {}),
    handler: async (args, ctx) => {
      try {
        return await handler(args, ctx);
      } catch (error) {
        throw error instanceof ThreadsError ? toSlipway(error) : error;
      }
    },
  });
}

export function makeContext(client: ThreadsClient, config: Config): ToolContext {
  return { client, config, account: (hint?: string) => selectAccount(config, hint) };
}

/** Clamp a caller-supplied limit into a range Threads will accept. */
export function clamp(value: number | undefined, fallback: number, max = 100): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/** Trim a summary to one readable line for the audit log. */
export function snippet(text: string | undefined, length = 60): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
