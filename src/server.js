const http = require("node:http");
const path = require("node:path");
const express = require("express");
const pty = require("node-pty");
const WebSocket = require("ws");

const MAX_BUFFER_BYTES = 512 * 1024;
const DEFAULT_KEYMAP = {
  Enter: "\r",
  Tab: "\t",
  Backspace: "\u007f",
  Escape: "\u001b",
  ArrowUp: "\u001b[A",
  ArrowDown: "\u001b[B",
  ArrowRight: "\u001b[C",
  ArrowLeft: "\u001b[D",
  Home: "\u001b[H",
  End: "\u001b[F",
  Delete: "\u001b[3~",
  PageUp: "\u001b[5~",
  PageDown: "\u001b[6~"
};

function defaultShell() {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe";
  }
  return process.env.XTERM_MCP_SHELL || "/bin/sh";
}

function shellSpec(shellOverride) {
  if (shellOverride && shellOverride.trim().length > 0) {
    if (process.platform === "win32") {
      return {
        command: process.env.COMSPEC || "cmd.exe",
        args: ["/d", "/s", "/c", shellOverride]
      };
    }
    return {
      command: "/bin/sh",
      args: ["-lc", shellOverride]
    };
  }

  const shell = defaultShell();
  if (process.platform === "win32") {
    return { command: shell, args: [] };
  }
  return { command: shell, args: [] };
}

function parseCtrlChord(key) {
  const match = /^Ctrl\+([A-Z])$/i.exec(key);
  if (!match) {
    return null;
  }
  const letter = match[1].toUpperCase().charCodeAt(0);
  return String.fromCharCode(letter - 64);
}

function stripAnsi(input) {
  return input.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\u001b[@-_]/g, "");
}

function resolveAuthToken(req) {
  const bearer = req.headers.authorization;
  if (bearer && bearer.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length).trim();
  }
  if (typeof req.query.token === "string") {
    return req.query.token;
  }
  if (typeof req.headers["x-terminal-token"] === "string") {
    return req.headers["x-terminal-token"];
  }
  return null;
}

function shouldAuthorize(requested, expected) {
  if (!expected) {
    return true;
  }
  return requested === expected;
}

function computeLastLines(text, count) {
  return text
    .split(/\r?\n/g)
    .filter((line) => line.length > 0)
    .slice(-count);
}

function createRuntime(config) {
  const spec = shellSpec(config.shell);
  const env = {
    ...process.env,
    TERM: "xterm-256color"
  };
  const terminal = pty.spawn(spec.command, spec.args, {
    name: "xterm-256color",
    cols: config.cols,
    rows: config.rows,
    cwd: config.cwd,
    env
  });

  let outputRaw = "";
  const addOutput = (chunk) => {
    outputRaw += chunk;
    if (Buffer.byteLength(outputRaw, "utf8") > MAX_BUFFER_BYTES) {
      const bytesToTrim = Buffer.byteLength(outputRaw, "utf8") - MAX_BUFFER_BYTES;
      outputRaw = outputRaw.slice(Math.min(bytesToTrim, outputRaw.length));
    }
  };

  return { terminal, addOutput, getOutput: () => outputRaw, clearOutput: () => (outputRaw = "") };
}

async function startServer(config) {
  const app = express();
  const server = http.createServer(app);
  const wsServer = new WebSocket.Server({ noServer: true });
  const runtime = createRuntime(config);

  const clients = new Set();
  const appStart = Date.now();

  const broadcast = (payload) => {
    const encoded = JSON.stringify(payload);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(encoded);
      }
    }
  };

  runtime.terminal.onData((data) => {
    runtime.addOutput(data);
    broadcast({ type: "output", data });
  });

  runtime.terminal.onExit(({ exitCode }) => {
    broadcast({ type: "exit", exitCode });
  });

  app.use(express.json({ limit: "256kb" }));
  app.use(
    "/vendor/xterm",
    express.static(path.join(__dirname, "..", "node_modules", "@xterm", "xterm", "lib"))
  );
  app.use(
    "/vendor/xterm-addon-fit",
    express.static(path.join(__dirname, "..", "node_modules", "@xterm", "addon-fit", "lib"))
  );
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use((req, res, next) => {
    const token = resolveAuthToken(req);
    if (!shouldAuthorize(token, config.token)) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptimeMs: Date.now() - appStart });
  });

  app.get("/api/state", (_req, res) => {
    res.json({
      ok: true,
      name: config.name,
      cwd: config.cwd,
      shell: config.shell || defaultShell(),
      cols: config.cols,
      rows: config.rows,
      clients: clients.size
    });
  });

  app.get("/api/buffer", (req, res) => {
    const lines = Number.parseInt(req.query.lines || "200", 10);
    const boundedLines = Number.isInteger(lines) && lines > 0 ? Math.min(lines, 5000) : 200;
    const raw = runtime.getOutput();
    const plain = stripAnsi(raw);
    res.json({
      ok: true,
      bytes: Buffer.byteLength(raw, "utf8"),
      raw,
      plain,
      lines: computeLastLines(plain, boundedLines)
    });
  });

  app.post("/api/type", (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (text.length === 0) {
      res.status(400).json({ ok: false, error: "missing text" });
      return;
    }
    runtime.terminal.write(text);
    res.json({ ok: true, bytes: Buffer.byteLength(text, "utf8") });
  });

  app.post("/api/keypress", (req, res) => {
    const key = typeof req.body?.key === "string" ? req.body.key : "";
    if (key.length === 0) {
      res.status(400).json({ ok: false, error: "missing key" });
      return;
    }
    const mapped = DEFAULT_KEYMAP[key] || parseCtrlChord(key);
    if (!mapped) {
      res.status(400).json({ ok: false, error: `unsupported key '${key}'` });
      return;
    }
    runtime.terminal.write(mapped);
    res.json({ ok: true, key });
  });

  app.post("/api/exec", (req, res) => {
    const command = typeof req.body?.command === "string" ? req.body.command : "";
    if (command.trim().length === 0) {
      res.status(400).json({ ok: false, error: "missing command" });
      return;
    }
    runtime.terminal.write(`${command}\r`);
    res.json({ ok: true, command });
  });

  app.post("/api/resize", (req, res) => {
    const cols = Number.parseInt(req.body?.cols, 10);
    const rows = Number.parseInt(req.body?.rows, 10);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
      res.status(400).json({ ok: false, error: "invalid cols/rows" });
      return;
    }
    config.cols = cols;
    config.rows = rows;
    runtime.terminal.resize(cols, rows);
    broadcast({ type: "resize", cols, rows });
    res.json({ ok: true, cols, rows });
  });

  app.post("/api/clear", (_req, res) => {
    runtime.clearOutput();
    res.json({ ok: true });
  });

  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const token = requestUrl.searchParams.get("token") || null;
    if (!shouldAuthorize(token, config.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit("connection", ws, req);
    });
  });

  wsServer.on("connection", (ws) => {
    clients.add(ws);
    ws.send(
      JSON.stringify({
        type: "hello",
        name: config.name,
        cols: config.cols,
        rows: config.rows,
        cwd: config.cwd,
        buffered: runtime.getOutput()
      })
    );

    ws.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch (_error) {
        return;
      }

      if (payload?.type === "input" && typeof payload.data === "string") {
        runtime.terminal.write(payload.data);
      } else if (payload?.type === "resize") {
        const cols = Number.parseInt(payload.cols, 10);
        const rows = Number.parseInt(payload.rows, 10);
        if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
          config.cols = cols;
          config.rows = rows;
          runtime.terminal.resize(cols, rows);
        }
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });

  const origin = `http://${config.host}:${config.port}`;
  const uiUrl = config.token ? `${origin}/?token=${encodeURIComponent(config.token)}` : `${origin}/`;

  console.log(`xterm-mcp running: ${uiUrl}`);
  console.log(`control API: ${origin}/api/*`);

  return {
    uiUrl,
    apiUrl: `${origin}/api`,
    async stop() {
      for (const client of clients) {
        client.close();
      }
      runtime.terminal.kill();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

module.exports = {
  startServer
};
