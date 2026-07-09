#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function usage() {
  console.error("Usage: node scripts/create-github-release.mjs [version]");
  console.error("Example: node scripts/create-github-release.mjs 0.4.2");
}

function normalizeVersion(value) {
  if (!value) return value;
  return value.startsWith("v") ? value.slice(1) : value;
}

function currentPackageVersion() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  return pkg.version;
}

function changelogNotes(version) {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## \\[${escaped}\\](?: - .*|\\s*)$`, "m");
  const match = heading.exec(changelog);
  if (!match) {
    throw new Error(`Could not find CHANGELOG.md section for ${version}`);
  }

  const start = match.index + match[0].length;
  const rest = changelog.slice(start);
  const next = rest.search(/^## \[/m);
  const notes = (next === -1 ? rest : rest.slice(0, next)).trim();
  if (!notes) {
    throw new Error(`CHANGELOG.md section for ${version} is empty`);
  }
  return notes;
}

function run(command, args, options = {}) {
  const output = execFileSync(command, args, { stdio: "pipe", encoding: "utf8", ...options });
  return typeof output === "string" ? output.trim() : "";
}

const arg = process.argv[2];
if (arg === "-h" || arg === "--help") {
  usage();
  process.exit(0);
}

const version = normalizeVersion(arg ?? currentPackageVersion());
const tag = `v${version}`;
const notes = changelogNotes(version);

try {
  run("gh", ["release", "view", tag]);
  console.log(`GitHub release ${tag} already exists.`);
  process.exit(0);
} catch {
  // Missing release: create it below.
}

const dir = mkdtempSync(join(tmpdir(), "llm-docs-release-"));
const notesFile = join(dir, "notes.md");
writeFileSync(notesFile, notes + "\n", "utf8");

try {
  run("gh", [
    "release",
    "create",
    tag,
    "--verify-tag",
    "--title",
    tag,
    "--notes-file",
    notesFile,
  ], { stdio: "inherit" });
  console.log(`Created GitHub release ${tag}.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
