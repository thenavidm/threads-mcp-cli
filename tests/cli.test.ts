/**
 * The two surfaces, now that Slipway builds both from ALL_TOOLS.
 *
 * Parsing, help and the exit-code contract are Slipway's and tested there. What
 * matters here: every tool arrives on both surfaces intact, the guard behaves as
 * the README promises, Meta's errors keep sensible exit codes even though Meta
 * sends almost all of them as HTTP 400, login and refresh stay reachable, and
 * the docs stay in step with the code.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT, toSlipwayError } from "@thenavidm/slipway";
import { checkApp, cli, connect } from "@thenavidm/slipway/testing";
import {
  AuthenticationError,
  ContainerError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  TextTooLongError,
  ThreadsError,
  TimeoutError,
  ValidationError,
  WriteBlockedError,
} from "../src/api/errors.js";
import { app } from "../src/app.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import { toSlipway } from "../src/tools/kit.js";

const env = {};

// Nothing here may touch a real token store.
afterEach(() => vi.unstubAllEnvs());
const emptyStore = () => vi.stubEnv("THREADS_TOKEN_STORE", join(mkdtempSync(join(tmpdir(), "threads-store-")), "tokens.json"));

describe("Threads on Slipway", () => {
  it("offers every tool as a command and over MCP, under the same names", async () => {
    const list = await cli(app, [], { env });
    for (const tool of ALL_TOOLS) expect(list.stdout).toContain(tool.command);

    const mcp = await connect(app, { env });
    const names = (await mcp.listTools()).map((tool) => tool.name).sort();
    await mcp.close();
    expect(names).toEqual(ALL_TOOLS.map((tool) => tool.name).sort());
  });

  it("refuses to post without --confirm, before anything reaches the network", async () => {
    const run = await cli(app, ["create-post", "--text", "hello"], { env });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stderr).code).toBe("refused");
    expect(run.stderr).toContain("--confirm");
  });

  it("hides every write when THREADS_READ_ONLY is set", async () => {
    const mcp = await connect(app, { env: { THREADS_READ_ONLY: "1" } });
    const tools = await mcp.listTools();
    await mcp.close();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("reports a missing argument by its flag and exits 2", async () => {
    const run = await cli(app, ["get-post"], { env });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stderr).error).toContain("--id");
  });

  it("calls a run with no profile connected not configured, exit 10", async () => {
    emptyStore();
    const run = await cli(app, ["whoami"], { env: {} });
    expect(run.code).toBe(EXIT.notConfigured);
  });

  it("keeps login and refresh reachable from the CLI", async () => {
    const help = (await cli(app, ["--help"], { env })).stdout;
    expect(help).toContain("threads-cli login [--manual] [--all-scopes] [--port N]");
    expect(help).toContain("threads-cli refresh");
    expect((await cli(app, ["login", "--help"], { env })).stdout).toContain("Usage: threads-cli login");
    emptyStore();
    expect((await cli(app, ["refresh"], { env: {} })).code).toBe(EXIT.notConfigured);
  });

  it("passes slipway check", async () => {
    const report = await checkApp(app, { env });
    expect(report.findings.filter((finding) => finding.level === "error")).toEqual([]);
  });
});

describe("Meta's errors keep sensible exit codes", () => {
  const at = "/me/threads";
  it.each([
    ["an expired token", new AuthenticationError("Token expired.", 400, at, { code: 190, subcode: 463 }), EXIT.auth],
    ["a missing permission", new PermissionError("Missing threads_content_publish.", 400, at, { code: 10 }), EXIT.auth],
    ["bad arguments", new ValidationError("Media URL unreachable.", 400, at, { code: 100 }), EXIT.usage],
    ["a post that is gone", new NotFoundError("Not found.", 404, at), EXIT.notFound],
    ["a spent quota", new RateLimitError("Posting quota used up.", 400, at, { code: 4 }), EXIT.rateLimited],
    ["a server failure", new ServerError("Internal error.", 500, at), EXIT.api],
    ["our own deadline", new TimeoutError("No answer in 30 s.", 0, at), EXIT.api],
    ["a container that never finished", new ContainerError("Container expired.", 0, at), EXIT.api],
    ["no answer at all", new ThreadsError("fetch failed", 0, at), EXIT.api],
    ["a write the server blocks", new WriteBlockedError("Writes are off."), EXIT.usage],
    ["a post over the limit", new TextTooLongError("Post is 612 characters."), EXIT.usage],
  ])("maps %s", (_label, error, code) => {
    expect(toSlipwayError(toSlipway(error)).exitCode).toBe(code);
  });

  /**
   * 190/463 (expired, a refresh fixes it) and 190/467 (invalidated, it does
   * not) differ only in the subcode, so the model needs it in the error.
   */
  it("keeps Meta's code, subcode and trace id in the error a client receives", () => {
    const error = new AuthenticationError("Token expired.", 400, at, { code: 190, subcode: 463, type: "OAuthException", traceId: "AbC123" });
    expect(toSlipway(error).toJSON()).toMatchObject({
      code: "auth",
      status: 400,
      details: { endpoint: at, meta_code: 190, meta_subcode: 463, meta_type: "OAuthException", trace_id: "AbC123" },
    });
  });
});

describe("documentation stays in step with the code", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf-8");
  const names = (text: string): Set<string> => new Set(text.match(/THREADS_[A-Z_]+/g) ?? []);
  const source = (dir: string): string =>
    readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? source(`${dir}${entry.name}/`) : entry.name.endsWith(".ts") ? read(`${dir}${entry.name}`) : ""))
      .join("\n");

  /** Every variable the server reads: this repo's code, and Slipway's as agent-context lists them. */
  const used = async (): Promise<Set<string>> => {
    const context = JSON.parse((await cli(app, ["agent-context"], { env })).stdout);
    return new Set([...names(source("../src/")), ...context.settings.map((setting: { env: string }) => setting.env)]);
  };

  /**
   * Two variables shipped undocumented and five never reached `--help`, which is
   * the kind of drift nobody notices because both sides look complete on their own.
   */
  it("documents every environment variable the server reads", async () => {
    const documented = names(read("../README.md"));
    expect([...(await used())].filter((v) => !documented.has(v))).toEqual([]);
  });

  // Since Slipway 0.1.15 the help names the settings that connect an account and the safety
  // switches, and counts the rest, which agent-context describes one by one.
  it("names every environment variable in --help or agent-context", async () => {
    const help = (await cli(app, ["--help"], { env })).stdout;
    const context = JSON.parse((await cli(app, ["agent-context"], { env })).stdout);
    const described = new Set(context.settings.map((setting: { env: string }) => setting.env));
    expect([...(await used())].filter((v) => !help.includes(v) && !described.has(v))).toEqual([]);
  });

  /**
   * Two in-page links pointed at headings that had been renamed, including the
   * one row routing a shell user to the CLI. The ship checklist's link pass only
   * greps http, so a dead `#anchor` is the kind that ships quietly.
   */
  it.each(["../README.md", "../INSTALL.md"])("has no dead in-page anchors in %s", (file) => {
    if (!existsSync(new URL(file, import.meta.url))) return; // repo may ship one doc
    const md = read(file);
    const slugs = new Set<string>();
    for (const [, heading] of md.matchAll(/^#{2,4} (.+)$/gm)) {
      const stripped = (heading as string).toLowerCase().replace(/[^\w\s-]/g, "");
      // GitHub keeps the trailing hyphen when a heading ends in an emoji.
      slugs.add(stripped.trim().replace(/\s+/g, "-"));
      slugs.add(stripped.replace(/\s+/g, "-"));
    }
    const dead = [...md.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)]
      .map((m) => m[1] as string)
      .filter((a) => !slugs.has(a));
    expect(dead).toEqual([]);
  });
});
