#!/usr/bin/env node
// Wrapper around electron-vite that clears ELECTRON_RUN_AS_NODE before launching.
// Claude Code (and any other Electron app used as a shell) sets this env var, which
// causes Electron to run as plain Node.js and breaks the entire Electron API.
"use strict";
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawnSync } = require("child_process");
const path = require("path");
const evite = path.resolve(__dirname, "../node_modules/.bin/electron-vite");
const [, , ...args] = process.argv;

const result = spawnSync(evite, args, {
	stdio: "inherit",
	env: process.env,
	shell: process.platform === "win32",
});

process.exit(result.status ?? 0);
