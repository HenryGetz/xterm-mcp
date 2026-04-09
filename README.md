# xterm-mcp

`xterm-mcp` is a tiny browser-terminal runtime you can install directly from GitHub and use for agentic TUI testing.

It gives you:
- A real PTY shell in the browser (xterm.js)
- WebSocket I/O for interactive typing
- HTTP control endpoints for automated keystrokes and command execution
- Cross-platform shell support (Linux/macOS/Windows)

## Install (GitHub one-liner)

```bash
npm i -g git+ssh://git@github.com/HenryGetz/xterm-mcp.git
```

HTTPS alternative:

```bash
npm i -g git+https://github.com/HenryGetz/xterm-mcp.git
```

## Quick start

```bash
xterm-mcp serve --open
```

Then open `http://127.0.0.1:8787`.

## Core commands

```bash
xterm-mcp serve --port 8787 --cwd .
xterm-mcp serve --token my-secret-token
xterm-mcp doctor
```

## Automation API

All APIs are under `/api/*`.

- `POST /api/type` `{ "text": "cargo test --locked\r" }`
- `POST /api/exec` `{ "command": "cargo build --release" }`
- `POST /api/keypress` `{ "key": "Ctrl+C" }`
- `POST /api/resize` `{ "cols": 160, "rows": 48 }`
- `GET /api/buffer?lines=200`
- `GET /api/state`

Example:

```bash
curl -sS -X POST http://127.0.0.1:8787/api/exec \
  -H 'content-type: application/json' \
  -d '{"command":"ls -la"}'
```

With token auth:

```bash
xterm-mcp serve --token supersecret

curl -sS -X POST "http://127.0.0.1:8787/api/exec?token=supersecret" \
  -H 'content-type: application/json' \
  -d '{"command":"pwd"}'
```

## Docker (optional)

Run inside a container:

```bash
docker compose up --build
```

## Why this exists

Agentic coding tools are usually weak at testing TUIs because they cannot reliably "drive" a real terminal. `xterm-mcp` gives an installable bridge with real keystrokes + terminal output capture so agents can iterate on terminal UIs like any other UI surface.

