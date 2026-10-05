# Threads MCP Server & CLI changelog

| Component | Version | Last Updated |
|-----------|---------|--------------|
| threads-mcp-cli | 2.0.1 | 2026-10-05 |
| @thenavidm/slipway | 0.1.17 | 2026-10-05 |

---

## 2.0.1, 2026-10-05

- **Built on Slipway 0.1.17**, which a fresh install of 2.0.0 already used. Since the Slipway 2.0.0 was measured on, 0.1.7, `which` also reads a tool's argument names and prints a title once where a description opens with it, and the general help names the settings that connect an account and the safety switches and counts the rest, which `agent-context` describes one by one. [Slipway's changelog](https://github.com/thenavidm/slipway/blob/main/CHANGELOG.md) lists the rest.
- **The README documents `THREADS_HTTP_ALLOWED_ORIGINS`**, the browser origins `--http` accepts, which Slipway reads.
- **A test checks that every setting is named in `--help` or described by `agent-context`**, where it asked `--help` to name each one.

## 2.0.0, 2026-10-05

Built on [Slipway](https://github.com/thenavidm/slipway) 0.1.7. The 30 tools keep their names and arguments, and every difference below was measured against 1.1.2 before release.

- **A person approves each post, reply, repost and delete over MCP.** Claude Code (2.1.246 and later) shows its own prompt for each one, and a client that can show forms asks with an approval form whose one box starts unticked. Approvals are signed, bound to the exact call and work once. Where a client can do neither, the model's `confirm: true` still counts, and `THREADS_CONFIRM=model` makes it enough everywhere, for an agent with no person to ask. The audit log records who approved each write.
- **A smaller tool list.** 11,356 tokens in Claude Code with every tool loaded, down from 12,745: the per-tool `$schema` line, an `execution` field and `additionalProperties: false` are gone. The last one advertised strict input while unknown keys were dropped anyway; the schema now says what happens.
- **Meta's errors keep their meaning.** Meta answers almost every failure with HTTP 400, an expired token included. The exit code now follows the error's class: an expired token or a missing permission exits 4, rejected arguments 2, a spent quota 7, and Meta's code, subcode and trace id reach the model in the error's `details`. 1.1.2 matched words in the message, so rejected arguments exited 5, which a script would retry.
- **Exit codes follow the house contract everywhere.** An unknown command and a write in read-only mode exit 2 instead of 1; `doctor`, `login` and `refresh` with nothing to work with exit 10 instead of 1; a refused refresh exits 4. 1 now means an unexpected error, and a Graph API that cannot be reached still exits 5.
- **Cheaper to find a command through the CLI.** `which <words>` finds one without the full list. In Codex, finding the command that publishes a staged post took 84,035 input tokens against 84,054 (median of five), in three commands either way, and over MCP the same task read the same.
- **`install <client>`** adds the server to Claude Code, Codex, Claude Desktop, Cursor, VS Code or Gemini CLI in each one's own format, naming only the settings that connect a profile.
- **Less work to start.** The entry turns on Node's compile cache, and the server spends 175 ms of CPU before its first answer where 1.1.2 spent 210 (median of 21 runs, taking turns on one busy Mac). npx installs 4 dependencies instead of 94.
- **`doctor` asks Meta every time, as before, and stops failing a profile for something it cannot change.** Geo-gating is switched on by Meta per profile and nothing can request it, so a profile without it is a warning, not a failure.
- **`--help` lists every setting the server reads**, Slipway's own included, `login [--manual] [--all-scopes] [--port N]` and `refresh` show what they take, and restored tests keep the README and `--help` in step with the code.
- **README fixes.** The exit-code example script no longer reads the status of `!`, `/health` is described as it answers, the release workflow attaches the desktop extension the README sends people to, the desktop manifest names all nine tools that need approval, and images load from cdn.navid.me. THIRD_PARTY_NOTICES.md lists the production dependencies' licenses.

### Upgrading

Node 22 or newer. Scripts keep working for success, usage errors and missing setup; a script that treated exit 1 as "unknown command" or "read-only" should read 2, and one that retried a 5 on rejected arguments now gets 2. Over MCP, expect an approval prompt or form for each post; a headless agent that should post with `confirm: true` alone needs `THREADS_CONFIRM=model`. A script that pipes JSON-RPC into the server must keep stdin open until it reads the answer: the server now stops when its input ends, as the MCP stdio binding asks. Over HTTP, `GET /health` returns the name, version and tool count, and no longer tells anyone who can reach it how many profiles are connected or how long their tokens last; `doctor` and the `threads://accounts` resource still do. `--http --port` with something that is not a port number stops with exit 2 instead of using the default. Two terminal screens grew: the general help by 83 tokens, for `which`, `install`, the flags, the exit codes and the safety settings it now lists, and the command list by 23, for the lines that point to `which` and `--help`. `SKILL.md` is 68 tokens longer in Claude Code, for the approval rule, `which` and the full exit codes.

## 1.1.2, 2026-10-04

- **`npx -y @thenavidm/threads-mcp-cli` starts the MCP server whatever order npm keeps.** npx starts whichever binary the npm registry lists first when they share one file, and the registry does not keep the published order. For this package that happened to be the server; for 23 others it was the CLI. A third binary named after the package, on its own file, now always starts the server, and npx picks it by name.

## 1.1.1

`--port` only accepted `--port=8787`. Written the ordinary way, `--port 8787`
fell through to the default and bound 8787 anyway, with nothing printed. A flag
that is silently ignored is worse than one that errors: the server comes up, the
port is wrong, and nothing says so.

Both spellings now work, in both places that read the flag. The second was
`login --port`, which INSTALL.md tells you to reach for when 8788 is already
taken during setup — so the fault sat on the first command a new user types.

One parser now serves both, with 13 tests covering the equals form, the space
form, an absent flag, a trailing `--port` with nothing after it, a prefix that
merely starts the same way, and a typo that used to be able to bind `NaN`.

There is deliberately no `--host` flag. Binding a public interface takes
`THREADS_HTTP_HOST`, an environment variable someone has to mean, rather than a
word typed next to `--http`. A Threads token can post as you.

---

## 1.1.0

A second surface, and a new name to match it.

### The CLI

Every one of the 30 tools is now also a shell command. `threads-cli` lists them,
`threads-cli <command> --help` derives the flags from the same Zod schema an MCP
client is handed, and `threads-cli schema <command>` prints that schema so you
can check the two surfaces really are one thing. They read the same `ALL_TOOLS`
array through the same handlers and the same `WriteGuard`, so a tool added
tomorrow is a command tomorrow.

`--confirm` is the shell spelling of the confirmation posting and deleting
require. `--json`, `--compact` and `--agent` cover machine output, `--select
a,b.c` keeps only the fields you asked for, and errors are JSON on stderr
whichever you pick.

Exit codes a script can branch on without reading prose: 0 ok, 2 bad arguments
or a refused write, 3 not found, 4 the token was rejected, 5 the Threads API
failed, 7 rate limited, 10 nothing configured yet. `doctor`, `login` and
`refresh` are reachable from the CLI binary, because they are what someone
types when nothing works yet.

The point of the second surface is what it costs. The MCP server sends all 30
tool definitions on every turn, measured at ~9,450 tokens. A command sends
nothing until you type it.

### Renamed to threads-mcp-cli

The package is now `@thenavidm/threads-mcp-cli` and the repository is
`thenavidm/threads-mcp-cli`. `@thenavidm/threads-mcp` is deprecated on npm and
points at the new name. The binaries are unchanged: `threads-mcp` for the server,
`threads-cli` for the shell.

Every GitHub link also moved from the old account name to `thenavidm`. The old
one only resolved through GitHub's rename redirect, which stops working the
moment someone else claims it.

### Claude Desktop extension

`desktop-extension/build.sh` produces a `.mcpb` that installs on a double click.
It vendors its own dependencies rather than shelling out to `npx`, and its
`user_config` takes a pasted token, a username and a read-only switch. Leave the
token empty and it picks up the refreshable one `login` wrote.

---

## 1.0.0

First release. TypeScript, 30 tools, 57 tests.

### Four things Threads does differently

**Publishing is two calls with a gap in the middle.** A container is created,
it processes asynchronously, then it is published. Publishing into that gap
fails with an error that says nothing about timing, which is why so much Threads
automation works on text and breaks the first time someone attaches a video.
The container status is polled rather than slept on, starting at 500ms and
backing off to 4s, so text publishes almost immediately and a five-minute video
still works.

That unpublished container is also the only draft state Threads has: invisible,
valid for 24 hours, publishable later by id. Exposed as `stage_post` and
`publish_staged` rather than hidden inside a helper, because showing a human a
post before it is public is worth a tool of its own.

**The 500-character limit is not `String.length`.** Meta caps a post at 500
characters and counts emoji as UTF-8 bytes. A family emoji is one character to a
reader, eleven UTF-16 code units, and 25 bytes. So 130 of them is 130 characters,
comfortably inside the cap, and 3,250 bytes, which is refused. Both limits are
measured separately with `Intl.Segmenter`, and the error names which one was
crossed and by how much.

This matters most for `create_thread`. Threads has no thread endpoint: a thread
is ordinary posts chained by `reply_to_id`, so it can half-publish and nothing
rolls it back. Every part is validated before the first is published, and if a
later part still fails the error names exactly how far it got and gives back the
last published id.

**There is no edit.** No endpoint changes a published post. Fixing a typo means
delete and repost, losing the replies, likes and reposts, and spending one of
the 100 deletions the account gets per rolling 24 hours. That is why nine tools
refuse to run without `confirm: true`, and why `stage_post` exists.

`delete_post` uses HTTP DELETE. Sending POST to the same path returns a
success-shaped response for a request that deleted nothing.

**Tokens die on a 60-day clock.** A long-lived token can be refreshed once it is
24 hours old and never after it expires, and an expired one is replaced only by
walking the whole OAuth flow again. `threads-mcp login` stores the token where
the server can reach it, and it is then refreshed automatically inside the last
seven days of its life, plus reactively when Meta answers 190/463. A token
pasted into a client config cannot be refreshed by anything, and the docs say so
rather than letting it lapse quietly.

### Setup is one command

`threads-mcp login` opens the authorisation page, catches the redirect on a
loopback listener, exchanges the code, exchanges the short-lived token for a
60-day one, verifies it against `GET /me`, and writes it at mode 0600. The Meta
app itself still has to be created by hand, and the README walks through it,
including the Threads Tester role that everyone forgets and that makes every
call return empty until it is accepted.

`threads-mcp doctor` probes each capability separately rather than reporting one
verdict: publishing, replies, insights, keyword search, profile discovery and
geo-gating each get their own line, because Threads' permissions are granular
and a missing one usually reads as an empty result rather than an error.
`threads_keyword_search` is the worst of them, since Meta silently narrows an
unapproved search to your own posts, so both `doctor` and `search_keyword`
detect that case and say so.

### Output is a tenth the size

Listings render as tagged text rather than Graph API JSON. Timestamps are
normalized from Meta's `+0000` offset format to ISO-8601 UTC so they compare,
every attribute is escaped, quoted and reposted posts nest rather than
flattening, and hidden replies render as hidden so a gap in a conversation is
visible instead of implied.

### One tool that is not an endpoint

`get_top_posts` fetches recent posts, pulls insights for each, and ranks by
engagement against views. Sorting by raw likes mostly ranks posts by age.
Threads reports views alongside likes, replies, reposts and quotes, which makes
a real engagement rate possible, and nothing surfaces it by default.
