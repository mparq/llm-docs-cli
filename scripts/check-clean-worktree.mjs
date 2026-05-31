#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

let status;
try {
  git(["rev-parse", "--is-inside-work-tree"]);
  status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
} catch (error) {
  console.error("❌ Unable to inspect git working tree.");
  if (error instanceof Error && error.message) console.error(error.message);
  process.exit(1);
}

if (!status) {
  console.log("✅ Git working tree is clean.");
  process.exit(0);
}

const lines = status.split("\n");
const previewLimit = 50;
console.error("❌ Git working tree is dirty. Refusing to release from a mixed state.\n");
console.error(lines.slice(0, previewLimit).join("\n"));
if (lines.length > previewLimit) {
  console.error(`... and ${lines.length - previewLimit} more changed/untracked paths`);
}
console.error("\nCommit, stash, or remove these changes before releasing.");
process.exit(1);
