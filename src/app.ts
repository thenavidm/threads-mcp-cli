/**
 * The Threads app: everything Slipway needs to ship the MCP server and the CLI.
 *
 * This file only describes. It never starts anything, so `slipway check` and
 * tests can import it; `index.ts` is what runs.
 */

import { createRequire } from "node:module";
import { slipway } from "@thenavidm/slipway";
import { ThreadsClient } from "./api/client.js";
import { accountsFromStore } from "./auth/store.js";
import { daysRemaining } from "./auth/tokens.js";
import { loadConfig } from "./config.js";
import { doctor, expiringSoon } from "./doctor.js";
import { INSTRUCTIONS, PROMPTS, RESOURCES } from "./guide.js";
import { ALL_TOOLS } from "./tools/index.js";
import { makeContext, type ToolContext } from "./tools/kit.js";

const require = createRequire(import.meta.url);
export const VERSION: string = (require("../package.json") as { version: string }).version;

export const app = slipway<ToolContext>({
  name: "threads",
  title: "Threads",
  version: VERSION,
  package: "@thenavidm/threads-mcp-cli",
  description: "posting, chained threads, carousels, replies and reply approvals, insights, keyword search and profile discovery on Threads",
  instructions: INSTRUCTIONS,
  // The store is read here rather than inside loadConfig so that the config
  // module stays free of filesystem access and remains trivially testable.
  context: () => {
    const config = loadConfig(accountsFromStore(loadConfig().storePath));
    return makeContext(new ThreadsClient(config), config);
  },
  configured: (ctx) => ctx.config.accounts.length > 0,
  secrets: (ctx) => [...ctx.config.accounts.map((account) => account.accessToken), ctx.config.appSecret],
  tools: ALL_TOOLS,
  resources: [
    {
      name: "threads-accounts",
      uri: "threads://accounts",
      mimeType: "application/json",
      read: (ctx) => ({
        count: ctx.config.accounts.length,
        accounts: ctx.config.accounts.map((a) => ({
          username: a.username ?? null,
          user_id: a.userId ?? null,
          source: a.source,
          token_days_left: daysRemaining(a) ?? null,
        })),
        read_only: ctx.config.readOnly,
      }),
    },
    ...RESOURCES.map((resource) => ({ name: resource.name, uri: resource.uri, mimeType: resource.mimeType, read: () => resource.text })),
  ],
  prompts: PROMPTS.map((prompt) => ({ name: prompt.name, description: prompt.description, render: () => prompt.text })),
  doctor,
  // A missing scope reads as an empty result and an expired token as a rejection, so doctor asks Meta every time, as 1.1 did.
  doctorNetwork: true,
  login: {
    usage: "login [--manual] [--all-scopes] [--port N]",
    help: "authorize a Threads profile in the browser and store a 60-day token; --manual pastes a token instead",
    run: async (_io, args) => {
      const { runLogin } = await import("./auth/login.js");
      return runLogin(args);
    },
  },
  commands: [
    {
      name: "refresh",
      help: "extend every stored token by another 60 days",
      run: async (io) => {
        const { runRefresh } = await import("./auth/refresh.js");
        return runRefresh((line) => io.stdout(`${line}\n`));
      },
    },
  ],
  onServe: (ctx, log) => {
    const soon = expiringSoon(ctx.config);
    if (soon.length) {
      log.warn(`${soon.length} token(s) expire within a week and will be refreshed automatically on the next call. An expired Threads token cannot be recovered.`);
    }
  },
  settings: [
    { env: "THREADS_ACCOUNTS", description: 'Several profiles at once: [{"access_token":"THQ...","username":"you"}].', secret: true },
    { env: "THREADS_ACCESS_TOKEN", description: "A long-lived token for one profile.", secret: true },
    { env: "THREADS_USER_ID", description: "Its numeric profile id. Resolved from the token when absent." },
    { env: "THREADS_USERNAME", description: "Its username, for matching and display. Also resolved." },
    { env: "THREADS_DEFAULT_ACCOUNT", description: "Which username acts when a tool names none." },
    { env: "THREADS_APP_ID", description: "Threads app id from developers.facebook.com, for `login` only." },
    { env: "THREADS_APP_SECRET", description: "Threads app secret, for `login` only.", secret: true },
    { env: "THREADS_TOKEN_STORE", description: "Where tokens are kept. Defaults to ~/.threads-mcp/tokens.json." },
    { env: "THREADS_PERSIST_TOKENS", description: "0 stops writing refreshed tokens back to the store.", tuning: true },
    { env: "THREADS_REFRESH_WINDOW_DAYS", description: "Refresh this many days before expiry. Defaults to 20.", tuning: true },
    { env: "THREADS_CONTAINER_TIMEOUT_MS", description: "How long to wait for media to process. Defaults to 120000.", tuning: true },
    { env: "THREADS_REQUEST_TIMEOUT_MS", description: "Per-request deadline. Defaults to 30000.", tuning: true },
    { env: "THREADS_MIN_REQUEST_INTERVAL_MS", description: "Spacing between requests. Defaults to 120.", tuning: true },
    { env: "THREADS_MAX_RETRIES", description: "Retries on 5xx and quota codes. Defaults to 3.", tuning: true },
    { env: "THREADS_GRAPH_HOST", description: "The Graph host. Defaults to graph.threads.net.", tuning: true },
    { env: "THREADS_USER_AGENT", description: "The User-Agent sent to Meta. Defaults to threads-mcp.", tuning: true },
  ],
  links: { repository: "https://github.com/thenavidm/threads-mcp-cli" },
});
