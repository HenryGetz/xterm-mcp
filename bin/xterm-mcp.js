#!/usr/bin/env node

const path = require("node:path");
const { Command } = require("commander");
const open = require("open");
const { startServer } = require("../src/server");

const program = new Command();

program
  .name("xterm-mcp")
  .description("Run a browser terminal + control API for agentic TUI testing")
  .version("0.1.0");

program
  .command("serve")
  .description("Start the browser terminal server")
  .option("-p, --port <port>", "HTTP port", "8787")
  .option("--host <host>", "bind host", "127.0.0.1")
  .option("--cwd <dir>", "working directory", process.cwd())
  .option("--shell <cmd>", "shell command")
  .option("--name <name>", "session name", "xterm-mcp")
  .option("--open", "open browser after start", false)
  .option("--token <token>", "auth token for API/WebSocket")
  .option("--rows <rows>", "initial terminal rows", "42")
  .option("--cols <cols>", "initial terminal cols", "140")
  .action(async (opts) => {
    const config = {
      host: opts.host,
      port: Number.parseInt(opts.port, 10),
      cwd: path.resolve(opts.cwd),
      shell: opts.shell,
      name: opts.name,
      token: opts.token,
      rows: Number.parseInt(opts.rows, 10),
      cols: Number.parseInt(opts.cols, 10)
    };

    if (!Number.isInteger(config.port) || config.port <= 0) {
      throw new Error(`Invalid --port value: ${opts.port}`);
    }
    if (!Number.isInteger(config.rows) || config.rows <= 0) {
      throw new Error(`Invalid --rows value: ${opts.rows}`);
    }
    if (!Number.isInteger(config.cols) || config.cols <= 0) {
      throw new Error(`Invalid --cols value: ${opts.cols}`);
    }

    const runtime = await startServer(config);

    if (opts.open) {
      await open(runtime.uiUrl).catch((error) => {
        console.warn(`Could not open browser: ${error.message}`);
      });
    }

    const shutdown = () => {
      runtime.stop().finally(() => process.exit(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program
  .command("doctor")
  .description("Validate local runtime dependencies")
  .action(() => {
    const node = process.version;
    const platform = `${process.platform}/${process.arch}`;
    const shell =
      process.platform === "win32"
        ? process.env.COMSPEC || "powershell.exe"
        : process.env.SHELL || "/bin/sh";
    const payload = {
      ok: true,
      node,
      platform,
      shell,
      cwd: process.cwd()
    };
    console.log(JSON.stringify(payload, null, 2));
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error.message);
  process.exit(1);
});

