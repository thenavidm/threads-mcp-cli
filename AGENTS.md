# Working on threads-mcp-cli

For agents editing this repository. Users read the README. Driving the server is
`SKILL.md`.

## Layout

```
src/app.ts      the Slipway app: tools, settings, login, refresh. Slipway owns both surfaces, the guard and the audit log
src/guide.ts    server instructions, resources and prompts
src/doctor.ts   one probe per capability, so a missing scope is named
src/api/        client, errors (Meta's codes sorted into classes), identity
src/auth/       login, refresh, tokens, the token store
src/tools/      one module per group, registered in tools/index.ts; kit.ts maps Meta's errors to exit codes
```

## Non-negotiables

**Commit as `n@navid.me`.** Never pass `-c user.email=`. The global config is
correct and the override is the bug.

**Threads is not Instagram.** Separate API, separate permissions, separate token
against its own host. An Instagram token does nothing here. One Meta app can
carry both use cases, but each product mints its own token.

**Writes are on by default.** `THREADS_READ_ONLY=1` removes the write tools from
the list rather than refusing at call time.

**Approval on publishing and deleting only.** Over MCP a person approves each
in the client; `confirm: true` counts only where the client cannot ask. Hiding
a reply is one click to undo and is not guarded. Confirming everything trains the reflex that makes
the confirmation on a delete worthless.

**A missing scope and an ungranted App Review look identical from a tool call.**
That is why `doctor` probes each capability and names which scope is absent
rather than leaving the caller to guess. Keep that true when adding tools.

**Every anticipated failure is a `ThreadsError` subclass** from `api/errors.ts`.
Meta sends almost all of them as HTTP 400, so `tools/kit.ts` maps the class, not
the status, to the exit code, and passes Meta's code and subcode on in the
error's `details`. A plain `Error` keeps its message but exits 1, unexpected,
unless its words match a known failure.

**Do not imply it can read other people's posts.** Meta's API does not expose
them, so competitor research is not something this can do honestly.

## Before claiming it works

```bash
npm run build && npm test && npm run typecheck
npx @modelcontextprotocol/inspector node dist/index.js
```
