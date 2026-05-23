# Agent Guidelines for yash Repository

## Essential Commands

- **Check specifications**: `cat SPECS.md`
- **Read project info**: `cat README.md`
- **Check status / ongoing work**: read both sources and merge:
  1. `cat tmp/ONGOING.md 2>/dev/null || echo "No ongoing work"`
  2. `gh issue list --label "ai-ready,idea" --state open --json number,title,body,url`
- **Send a command to a running yash instance**: `bun run cmd <command>` (e.g. `bun run cmd /marker Intro`)
  - Requires yash to be running; exits 1 with "yash is not running" if the socket is absent
  - The slash prefix is optional: `bun run cmd marker Intro` is equivalent to `bun run cmd /marker Intro`

## Alias
- [root]: workspace repository.
- [tmp]: folder for temporary files excluded from versioning.

## tmp/ Is Never Committed

**Never `git add` any file under `tmp/`**, even with `-f`/`--force`.

`tmp/` is gitignored because it holds ephemeral local artifacts (build outputs,
seed scripts, VHS tapes, test databases, recordings, …).  These must not enter
the repository history — not even on feature branches.

For demos specifically, treat `tmp/` as the only workspace for:
- VHS tapes and helper shell scripts
- Playwright recordings and GIF conversions
- screenshots, GIFs, videos, and any other binary artifacts
- one-off repro helpers or capture scripts used only for a PR/demo

Do not create new demo artifacts in tracked folders such as `demo/`, `docs/`,
or `assets/`. Existing tracked files in those locations are legacy and should
not be copied as a pattern for new work.

If you have a script or tape that truly belongs in version control as a reusable
fixture, move it to an appropriate tracked directory (e.g. `scripts/`,
`test/fixtures/`) and commit it there intentionally. Otherwise keep it in
`tmp/`.

## Getting Started

When beginning work in this repository:
1. Review SPECS.md for current requirements
2. Follow the specifications for any implementation work
3. All implementation should adhere to the requirements in SPECS.md
4. **When adding new functionality**, update SPECS.md to document it (under the relevant section, e.g. Features, Goals, or Development Commands)
5. **When testing TUI components**: Use the `/test-live` skill — it covers the `yash` tmux session workflow (window `yash:all`), how to start/restart the app, capture screen output, trigger events, and verify modal behaviour
6. **When building or updating TUI modals** (such as `/stream`, `/settings`, or future settings/edit dialogs): keep descriptive labels aligned with other modal rows, indent editable value fields slightly further right than their description to show the relationship clearly, and verify the rendered spacing in the live `yash` tmux session rather than trusting code inspection alone
7. **ALWAYS Write** ongoing work/parts in `[tmp]/ONGOING.md` to keep track of everything
8. **Clean `[tmp]/ONGOING.md` immediately after completion is verified** — remove each item as soon as the work is confirmed done by tests, runtime checks, or explicit user verification; do not leave completed items in the file

## No Binary Files Policy

Never commit binary files (images, GIFs, fonts, archives, compiled artifacts, etc.) to the repository.

- Store temporary assets in `[tmp]` — it is gitignored and safe.
- Keep PR/demo source artifacts there too: VHS tapes, recording helper scripts,
  Playwright videos, converted GIFs, and screenshots all belong under
  `[tmp]/...`, not in tracked repo folders.
- For demo GIFs or screenshots that need to be publicly hosted (e.g. inlined in a PR), upload them to the dedicated **`screenshots` release** — a permanent prerelease used exclusively as an asset store:
  ```bash
  gh release upload screenshots tmp/my-demo.gif --clobber
  # URL will be: https://github.com/slhad/yash/releases/download/screenshots/my-demo.gif
  ```
  The `screenshots` release already exists at https://github.com/slhad/yash/releases/tag/screenshots.
  If it ever needs to be recreated:
  ```bash
  gh release create screenshots \
    --title "Screenshots & Assets" \
    --notes "Dedicated release for hosting screenshots, GIFs, and other media assets referenced in PRs and documentation. Not a software release." \
    --prerelease
  ```
- Never create a `docs/`, `assets/`, or similar directory just to store binaries in git.
- Never add new files under `demo/` for PR artifacts; use `tmp/` plus hosted release assets instead.

## Protobuf / Long integer shim (YouTube gRPC decoder)

`protobufjs` silently mishandles 64-bit integers under Bun unless `Long` is explicitly patched in at startup. Without the shim, timestamps and IDs decoded from YouTube's live-chat gRPC stream will be wrong or zero.

The shim must run before any protobuf decode call:

```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const longModule = require("long");
const Long = typeof longModule?.fromNumber === "function" ? longModule : longModule?.default;
if (Long && typeof Long.fromNumber === "function") {
  const protobuf = require("protobufjs");
  const protobufMinimal = require("protobufjs/minimal");
  protobuf.util.Long = Long;
  protobuf.configure();
  protobufMinimal.util.Long = Long;
  protobufMinimal.configure();
  globalThis.Long = Long;
}
```

The double-form guard (`longModule?.fromNumber ?? longModule?.default`) is intentional — the `long` package's ESM/CJS export shape differs between versions and Bun resolves it differently depending on context.

## Pull Requests

Before opening a PR, you **must** complete every step below in order. Do not skip or mark a step done without actually running it.

For steps that are **not applicable** to the current change (e.g. no TUI changes → no VHS recording needed), mark the checklist item `[x]` with a short `N/A — reason` explanation. Never leave an unrelated item unchecked — an unchecked box signals a missing action, not an inapplicable one.

1. **Unit tests** — run the unit test file(s) relevant to your changes: `bun test test/<relevant>.unit.test.ts` — all must pass
2. **Repo policy validation** — `bun run validate:repo` — no tracked demo artifacts outside `tmp/`, no tracked binary changes outside `tmp/`
3. **Full test suite** — `bun run test` — 0 failures
4. **Type check** — `bun typecheck` — no errors
5. **Live TUI check** — verify the feature in the running yash tmux session (window `yash:all`); use the `/test-live` skill
6. **Live Web UI check** — verify the feature in the web UI
7. **VHS recording** — create tapes, helper scripts, and generated GIFs under `tmp/` only; generate the TUI demo GIF last, once all checks above pass; host it via the `screenshots` release and link it in the Demo section
8. **Playwright recording** — generate the Web UI demo GIF last, once all checks above pass:
   ```bash
   RECORD_VIDEO=1 npx playwright test --project=chromium
   # videos land in tmp/playwright-output/<test-name>/video.webm
   ffmpeg -i tmp/playwright-output/<test-name>/video.webm -vf "fps=10,scale=800:-1:flags=lanczos" tmp/<feature>-web.gif
   gh release upload screenshots tmp/<feature>-web.gif --clobber
   ```
   Keep any helper scripts, converted media, and staging files under `tmp/`, and link the resulting hosted URL in the Demo section alongside the VHS GIF.

9. **Docs update** — before opening the PR, update `SPECS.md` to reflect any new or changed commands, settings, API routes, env vars, or behavior; update `README.md` if setup steps, IPC behavior, or architecture changed.

Only after all steps pass, create the PR following the conventions in `.github/PULL_REQUEST_TEMPLATE.md`. PR titles feed directly into the GitHub release changelog.

## External References

- Kick event subscription docs: `https://docs.kick.com/events/subscribe-to-events`
- Kick webhook payload docs: `https://docs.kick.com/events/event-types`

## Working with Bun
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun run <script>` for package scripts so Bun lifecycle hooks such as `pretest`, `prestart`, and `post*` actually run
- Use `bun run validate:repo` before treating a branch as PR-ready; it enforces the tracked demo/binary artifact policy
- Do not replace `bun run test` with `bun test` when you expect package-script checks to run; `bun test` bypasses `package.json` lifecycle hooks
- Use `bun test` only when you intentionally want the raw Bun test runner without script hooks
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

### APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

### Testing

Prefer `bun run test` for the normal repo test flow so `pretest` checks run first. Use `bun test` only for intentionally targeted raw test-runner invocations when skipping lifecycle hooks is acceptable.

- Any test that can read, write, clear, or mutate persisted runtime state must isolate itself under repository-local `tmp/tests/...`.
- Tests must never read from or write to the real user data directory such as `~/.config/yash`, even indirectly through default provider/service paths.
- When a test exercises code that uses persisted auth, tokens, webhook cache, logs, IPC socket (`yash.sock`), or other filesystem-backed state, it must override `YASH_DATA_DIR` to a dedicated temp directory under `[tmp]` and clean it up after the test or suite finishes.
- Prefer shared helpers for test temp directories instead of ad hoc paths so this behavior stays consistent across the suite.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## CLI IPC Subsystem

yash exposes a Unix Domain Socket (UDS) so external processes can send commands to a running TUI instance.

### Files

| File | Role |
|------|------|
| `src/ipc/socket-path.ts` | Resolves `${YASH_DATA_DIR}/yash.sock` via `resolveSocketPath()` |
| `src/ipc/server.ts` | UDS server started by the TUI at boot (`startIpcServer`); deletes any stale socket on startup; cleans up the socket on process exit |
| `src/ipc/client.ts` | CLI client (`sendCliCommand`); prints response to stdout; exits 1 on ENOENT/ECONNREFUSED with "yash is not running" |
| `src/cli.ts` | CLI entry point; invoked via `bun run cmd`; prepends `/` to commands that lack it |

### Protocol

One request / one response per connection, both newline-terminated JSON:

- Request: `{"command": "/marker Intro"}\n`
- Response (success): `{"ok": true, "output": "..."}\n`
- Response (failure): `{"ok": false, "error": "..."}\n`

The server calls `socket.end()` after writing the response.

### `commandHandlers` and the `emit` callback

`commandHandlers` in `src/index.tsx` is typed as:

```ts
Record<string, (parts: string[], emit: (line: string) => void) => Promise<void>>
```

- **TUI path**: `emit = (line) => lastMessages.push(line)` — output appears in the TUI chat area.
- **IPC path**: `emit = (line) => lines.push(line)` — lines are joined with `\n` and returned as the IPC `output`.

When adding a new command handler, always use `emit` for all output. Never write directly to `lastMessages` or `process.stdout` inside a handler.

### Blocked commands over IPC

The following commands are rejected when called via IPC:

| Command | Reason |
|---------|--------|
| `/exit` | Would kill the live TUI before the response is sent |
| `/stream` | Opens a TUI modal |
| `/setup-youtube` | Opens a TUI modal |
| `/history` | Opens a TUI modal |
| `/chatter` | Opens a TUI modal |
| `/settings` (bare) | Opens a TUI modal |

`/settings get <key>` and `/settings set <key> <value>` work fine over IPC. When adding a new command that opens a modal or performs a TUI-only side effect, add it to the `tuiOnlyCommands` set in `handleCommandForCli` in `src/index.tsx`.

### Testing with IPC / socket isolation

- The socket path derives from `YASH_DATA_DIR` via `getDataDir()`. Tests that exercise IPC or anything touching `resolveSocketPath()` must set `YASH_DATA_DIR` to a directory under `tmp/tests/` to avoid colliding with a real running yash instance.
- Clean up the socket file (`yash.sock`) in `afterAll` if the test starts a server directly — `process.on('exit', cleanup)` only fires on clean exit and will not run if a test crashes.
- Example isolation pattern:
  ```ts
  const origDataDir = process.env.YASH_DATA_DIR;
  beforeAll(() => { process.env.YASH_DATA_DIR = 'tmp/tests/ipc-my-test'; });
  afterAll(() => {
    if (origDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = origDataDir;
  });
  ```
