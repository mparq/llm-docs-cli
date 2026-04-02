#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = join(__dirname, "..", "src", "cli.ts");

try {
  execFileSync(process.execPath, ["--import", "tsx/esm", cli, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
} catch (err) {
  process.exitCode = err.status || 1;
}
