#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = join(__dirname, "..", "dist", "cli.js");

try {
  execFileSync(process.execPath, [cli, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
} catch (err) {
  // execFileSync throws on non-zero exit — just propagate the exit code
  process.exitCode = err.status || 1;
}
