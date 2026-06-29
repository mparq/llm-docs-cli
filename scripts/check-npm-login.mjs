#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function npm(args) {
  return execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let registry;
try {
  registry = npm(["config", "get", "registry"]);
} catch {
  registry = "https://registry.npmjs.org/";
}

try {
  const user = npm(["whoami", "--registry", registry]);
  console.log(`✅ npm authenticated as ${user} (${registry}).`);
} catch {
  console.error("❌ npm is not authenticated. Run `npm login` before releasing.");
  console.error(`   Registry: ${registry}`);
  console.error("   After login, verify with `npm whoami`, then rerun `npm publish`.");
  process.exit(1);
}
