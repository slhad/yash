# Agent Guidelines for yash Repository

## Essential Commands

- **Check specifications**: `cat SPECS.md`
- **Read project info**: `cat README.md`
- **Read on going work**: `cat tmp/ONGOING.md 2>/dev/null||echo "No on going work, analyse codebase to find work to do"`

## Alias
- [root]: workspace repository.
- [tmp]: folder for temporary files excluded from versioning.

## Getting Started

When beginning work in this repository:
1. Review SPECS.md for current requirements
2. Follow the specifications for any implementation work
3. All implementation should adhere to the requirements in SPECS.md
4. **When adding new functionality**, update SPECS.md to document it (under the relevant section, e.g. Features, Goals, or Development Commands)
5. **When testing TUI components**: Use the existing `yash` tmux session and relaunch the app there before verification
6. **ALWAYS Write** ongoing work/parts in `[tmp]/ONGOING.md` to keep track of everything
7. **Clean `[tmp]/ONGOING.md` immediately after completion is verified** — remove each item as soon as the work is confirmed done by tests, runtime checks, or explicit user verification; do not leave completed items in the file

## External References

- Kick event subscription docs: `https://docs.kick.com/events/subscribe-to-events`
- Kick webhook payload docs: `https://docs.kick.com/events/event-types`

## Working with Bun
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
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

Use `bun test` to run tests.

- Any test that can read, write, clear, or mutate persisted runtime state must isolate itself under repository-local `tmp/tests/...`.
- Tests must never read from or write to the real user data directory such as `~/.yash`, even indirectly through default provider/service paths.
- When a test exercises code that uses persisted auth, tokens, webhook cache, logs, or other filesystem-backed state, it must override `YASH_DATA_DIR` to a dedicated temp directory under `[tmp]` and clean it up after the test or suite finishes.
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
