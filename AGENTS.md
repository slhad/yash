# Agent Guidelines for yash Repository

## Essential Commands

- **Check specifications**: `cat SPECS.md`
- **Read project info**: `cat README.md`
- **Check status / ongoing work**: read both sources and merge:
  1. `cat tmp/ONGOING.md 2>/dev/null || echo "No ongoing work"`
  2. `gh issue list --label "ai-ready,idea" --state open --json number,title,body,url`
- **Check local ideas / candidate work**: `cat tmp/TO_PICK.md 2>/dev/null || echo "No local ideas to pick"`
- **Send a command to a running yash instance**: `bun run cmd <command>` (e.g. `bun run cmd /marker Intro`)
  - Requires yash to be running; exits 1 with "yash is not running" if the socket is absent
  - The slash prefix is optional: `bun run cmd marker Intro` is equivalent to `bun run cmd /marker Intro`

## Alias
- [root]: workspace repository.
- [tmp]: folder for temporary files excluded from versioning.

## tmp/ Is Never Committed

**Never `git add` any file under `tmp/`**, even with `-f`/`--force`.

`tmp/` is gitignored because it holds ephemeral local artifacts (build outputs,
seed scripts, asciinema casts, test databases, recordings, …).  These must not enter
the repository history — not even on feature branches.

For demos specifically, treat `tmp/` as the only workspace for:
- asciinema casts, agg conversions, and helper shell scripts
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
9. **When picking new work or ideas**, check `[tmp]/TO_PICK.md` in addition to the GitHub `ai-ready` idea queue
10. **Use one of these two pick-up paths for items from `[tmp]/TO_PICK.md`**:
    - If you are grooming or surfacing an idea, confirm it against the codebase, sharpen the problem statement a little, then create the corresponding GitHub issue so it becomes visible in the backlog
    - If you are directly starting implementation, copy the selected item into `[tmp]/ONGOING.md` and work from there even if no GitHub issue exists yet
11. **Once work is active, keep it in `[tmp]/ONGOING.md`** even if a matching GitHub issue also exists

## Keep Files Focused

- Do not add unrelated responsibilities to large entrypoints or catch-all modules. `src/index.tsx` may wire the TUI/runtime, but new command parsing, modal state, provider logic, web route logic, script config handling, or pure transformations should live in a focused module under `src/actions/`, `src/ui/`, `src/utils/`, `src/services/`, `src/platforms/`, or `src/scripts/` and be imported from the entrypoint.
- When changing an already-large file, keep the patch localized. If a feature needs more than a small adapter in that file, extract named helpers with tests instead of growing the file.
- Prefer seams that match existing boundaries: providers in `src/platforms`, stateful integrations in `src/services`, reusable command/action parsing in `src/actions` or `src/utils`, React/OpenTUI components in `src/ui`, and script-related behavior in `src/scripts`.
- Do not split just to satisfy a line count; keep tiny, single-use glue near its caller unless it creates a second responsibility or prevents focused testing.

## Memory / Retention Guardrails

- Treat long-lived arrays, maps, caches, timers, intervals, websocket clients, and event/listener subscriptions as leak-prone by default; any new process-lifetime structure must have an explicit bounded-retention or teardown story
- Do not rely on “the UI only renders the tail” as a memory bound; if a backing array or map can grow forever, cap or prune the backing store itself
- For in-memory history/caches, prefer hard caps or LRU-style eviction over “clear only when the user asks”
- For browser and TUI polling loops, prefer self-scheduling `setTimeout` loops that wait for the previous async pass to finish; if `setInterval` is still justified, document why overlapping work cannot happen
- Every new fetch/debounce/poll path in the Web UI must have cleanup on unmount; use `AbortController` for cancellable requests and clear the outstanding timeout/timer refs
- Any re-initialization path that replaces a live client/service (OBS, Twitch chat/EventSub, webhook relays, IPC server, etc.) must tear down the previous runtime first instead of just overwriting references
- Test-only/debug-only histories (for example reconnect attempt history) must stay bounded as well; do not keep unbounded diagnostic arrays in production code
- When adding or changing message history behavior, verify both the TUI and Web UI surfaces that use it (`/`, `/unified`, `/sidebyside`, browser input history, TUI browse/history surfaces)
- For changes touching polling, caches, chat history, activity/event logs, emote/image caches, or reconnect logic, add a short live-soak verification in addition to unit tests:
  - TUI: use `/test-live`, drive repeated events/messages through `yash:all`, and verify the app stays responsive after clears, modal opens, and reconnects
  - Web UI: leave the page open under traffic for several minutes, verify `/api/status`, `/api/obs/status`, and `/api/chat/history` stay stable, and check browser behavior on `/`, `/unified`, and `/sidebyside`

## Script Config Ownership In Docs

- Treat `YASH_DATA_DIR/config.json` and `YASH_DATA_DIR/settings.json` as YASH-owned only
- Document user scripts as owning `YASH_DATA_DIR/scripts/<scriptId>/config.jsonc` as the single script-owned source of truth, plus any other script-private runtime artifacts only when a task explicitly needs them
- Bundled scripts and bundled example scripts must expose both `/action <prefix>.config` and `/action <prefix>.configTUI`
- `<prefix>.config` must read and write the script-local settings surface in `YASH_DATA_DIR/scripts/<scriptId>/config.jsonc` and stay IPC-safe
- `<prefix>.configTUI` must edit that same `config.jsonc` surface through the live TUI, and must be marked TUI-only / rejected over IPC
- Do not describe user script runtime state as part of YASH's top-level settings surface
- Until YASH reaches v1, do not add or preserve migration logic for user/app data unless the task explicitly asks for it
- Prefer current-state correctness and simple resets over compatibility shims for old script/app data during pre-v1 work

## No Binary Files Policy

Never commit binary files (images, GIFs, fonts, archives, compiled artifacts, etc.) to the repository.

- Store temporary assets in `[tmp]` — it is gitignored and safe.
- Keep PR/demo source artifacts there too: asciinema casts, agg conversions,
  recording helper scripts, Playwright videos, converted GIFs, and screenshots all
  belong under `[tmp]/...`, not in tracked repo folders.
- For demo GIFs or screenshots that need a stable public download URL, upload them to the dedicated **`screenshots` release** — a permanent prerelease used exclusively as an asset store:
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
- For PR-body inline videos, do **not** use release asset URLs as the primary embed target. GitHub treats those as downloads and does not inline them reliably. Instead, use the repo-local Playwright uploader:
  ```bash
  bun ~/.agents/skills/github-pr-attachments/scripts/upload_pr_attachment.ts --pr <number> --file tmp/<feature>.mp4
  ```
  That workflow uploads through GitHub's PR conversation editor, produces a `https://github.com/user-attachments/assets/...` URL, and can optionally patch the PR body in place with `--mode apply --placeholder <token>`.
  The global skill script keeps its persistent profile at `~/.cache/codex/github-pr-attachments/playwright-profile`, so one GitHub sign-in can be reused across repositories.

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

For steps that are **not applicable** to the current change (e.g. no TUI changes → no asciinema recording needed), mark the checklist item `[x]` with a short `N/A — reason` explanation. Never leave an unrelated item unchecked — an unchecked box signals a missing action, not an inapplicable one.

1. **Unit tests** — run the unit test file(s) relevant to your changes: `bun test test/<relevant>.unit.test.ts` — all must pass
2. **Repo policy validation** — `bun run validate:repo` — no tracked demo artifacts outside `tmp/`, no tracked binary changes outside `tmp/`
3. **Full test suite** — `bun run test` — 0 failures
4. **Type check** — `bun typecheck` — no errors
5. **Live TUI check** — verify the feature in the running yash tmux session (window `yash:all`); use the `/test-live` skill
6. **Live Web UI check** — verify the feature in the web UI
7. **Asciinema/agg recording** — create asciinema casts, helper scripts, and generated GIFs under `tmp/` only; record in a real tmux pane when function keys are needed, convert with `agg`, generate the TUI demo GIF last once all checks above pass, then host it via the `screenshots` release and link it in the Demo section
8. **Playwright recording** — generate the Web UI demo MP4 last, once all checks above pass:
   ```bash
   RECORD_VIDEO=1 bunx playwright test --project=chromium
   # videos land in tmp/playwright-output/<test-name>/video.webm
   ffmpeg -i tmp/playwright-output/<test-name>/video.webm -pix_fmt yuv420p -movflags +faststart tmp/<feature>-web.mp4
   bun ~/.agents/skills/github-pr-attachments/scripts/upload_pr_attachment.ts --pr <number> --file tmp/<feature>-web.mp4
   ```
   Keep any helper scripts, converted media, and staging files under `tmp/`. Use the emitted `github.com/user-attachments/assets/...` URL on its own line in the PR body so GitHub renders the video inline. If the PR body is templated with a placeholder, use `--mode apply --placeholder <token>` to patch it directly.
   For demos that show external emotes or images, mock those assets locally (for example with `data:` URLs in Playwright API mocks) and wait for the rendered `<img>` elements to report `complete` before ending the recording; otherwise the captured video can show transient broken-image frames.

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

- Coverage requirement: run `bun run test:coverage` before treating coverage-sensitive work as complete; configured unit coverage must stay at or above 80% functions and 80% lines.
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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **yash** (3278 symbols, 10343 relationships, 266 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/yash/context` | Codebase overview, check index freshness |
| `gitnexus://repo/yash/clusters` | All functional areas |
| `gitnexus://repo/yash/processes` | All execution flows |
| `gitnexus://repo/yash/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
