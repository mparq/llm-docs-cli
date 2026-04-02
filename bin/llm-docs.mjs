#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = join(__dirname, "..", "src", "cli.ts");

// Resolve tsx/esm from this package's location, not the cwd
const tsxEsm = import.meta.resolve("tsx/esm");

try {
  execFileSync(process.execPath, ["--import", tsxEsm, cli, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
} catch (err) {
  process.exitCode = err.status || 1;
}
