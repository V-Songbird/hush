#!/usr/bin/env node
"use strict";

// Shared verbatim by the plugin branches. Foundry itself hosts both platforms;
// run this against a plugin repository, not against the parent marketplace.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const FOREIGN = {
  Codex: new Set([".claude", ".claude-plugin", "claude.md", "claude.local.md"]),
  Claude: new Set([".agents", ".codex", ".codex-plugin", "agents.md", "agents.override.md", "codex.md"]),
};

function platformName(value) {
  const name = Object.keys(FOREIGN).find(key => key.toLowerCase() === String(value || "").toLowerCase());
  if (!name) throw new Error(`Unknown platform ${JSON.stringify(value || "")}; use --platform Claude or --platform Codex.`);
  return name;
}

function violations(files, platform) {
  const expected = platformName(platform);
  return [...new Set(files)].filter(file =>
    ["benchmarks", ".benchmarks"].includes(file.replaceAll("\\", "/").split("/")[0].toLowerCase()) ||
    file.replaceAll("\\", "/").split("/").some(part => FOREIGN[expected].has(part.toLowerCase()))
  ).sort();
}

function git(repo, args) {
  // Hooks and callers can inherit GIT_DIR/GIT_INDEX_FILE from another checkout.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024,
  });
}

function trackedPaths(repo, { ref, staged = false } = {}) {
  if (ref && staged) throw new Error("Choose --ref or --staged, not both.");
  let output;
  if (ref) {
    const tree = git(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{tree}`]).trim();
    output = git(repo, ["ls-tree", "-r", "--name-only", "-z", tree]);
  } else {
    output = git(repo, ["ls-files", "-z", "--cached", ...(staged ? [] : ["--others", "--exclude-standard"])]);
  }
  const files = output.split("\0").filter(Boolean);
  // In working-tree mode, a tracked deletion is already absent. lstat keeps
  // symlinks visible even when their targets are missing.
  return ref || staged ? files : files.filter(file => {
    try { fs.lstatSync(path.join(repo, file)); return true; }
    catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return false; throw error; }
  });
}

function parseArgs(argv) {
  const options = { repo: process.cwd(), staged: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--staged") options.staged = true;
    else if (["--repo", "--platform", "--ref"].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      options[arg.slice(2)] = argv[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.ref && options.staged) throw new Error("Choose --ref or --staged, not both.");
  return options;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log("Usage: node scripts/git-hooks/check-platform-layout.js [--repo PATH] [--platform Claude|Codex] [--ref REF | --staged]\n\nDefault: check versionable working-tree files, including untracked files.\n--staged: check the Git index. --ref: check the complete committed tree.\nPlatform defaults to the PR base, push branch, or local branch.\nThe rule applies to reserved configuration paths at any depth, ignoring case.\nShared code and historical prose are not searched for platform names.");
      return 0;
    }
    options.repo = path.resolve(options.repo);
    // A PR's destination takes precedence over its source branch or merge ref.
    const platform = platformName(options.platform || process.env.GITHUB_BASE_REF || process.env.GITHUB_REF_NAME || git(options.repo, ["branch", "--show-current"]).trim());
    const files = trackedPaths(options.repo, options);
    if (files.some(file => file.toLowerCase() === ".agents/plugins/marketplace.json") &&
        files.some(file => file.toLowerCase() === ".claude-plugin/marketplace.json")) {
      throw new Error("This is the shared Foundry marketplace. Select a plugin repository with --repo.");
    }
    const bad = violations(files, platform);
    if (bad.length) {
      console.error(`${platform} platform layout failed (${bad.length} forbidden configuration or research paths):`);
      for (const file of bad) console.error(`  ${JSON.stringify(file)}`);
      return 1;
    }
    console.log(`${platform} platform layout passed (${files.length} files checked).`);
    return 0;
  } catch (error) {
    console.error(`Platform layout check could not complete: ${error.message}`);
    return 2;
  }
}

module.exports = { platformName, violations, trackedPaths, parseArgs, main };
if (require.main === module) process.exitCode = main();
