#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const FILES = ["LICENSE", "README.md", "assets/logo-dark.svg", "assets/logo.svg",
  ".github/check-main-frontpage.cjs", ".github/workflows/test.yml"];

function checkFiles(files, readme, plugin) {
  if (!["foreman", "hush", "razor"].includes(plugin)) throw new Error("Select foreman, hush or razor; Flint is outside this policy.");
  const errors = [];
  for (const file of files) if (!FILES.includes(file)) errors.push(`Unexpected main file: ${file}`);
  for (const file of FILES) if (!files.includes(file)) errors.push(`Missing main file: ${file}`);
  for (const edition of ["Claude", "Codex"]) {
    const target = `https://github.com/V-Songbird/${plugin}/tree/${edition}`;
    const links = [...readme.matchAll(/\[[^\]\n]+\]\((https:\/\/[^\s)]+)\)/g)].map(match => match[1]);
    if (!links.includes(target)) errors.push(`Missing ${edition} edition link: ${target}`);
  }
  if (/\/plugin\s+(?:install|marketplace)|\bcodex\s+plugin\s+(?:add|marketplace)/i.test(readme)) errors.push("Installation commands belong to the platform edition, not the main selector.");
  if (/foundry:edition|foundry:platform|^## (?:The numbers|Benchmarks)\s*$/m.test(readme)) errors.push("Platform README content or benchmarks do not belong to the main selector.");
  return errors;
}

function git(repo, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
}

function main(args = process.argv.slice(2)) {
  try {
    const options = { repo: process.cwd(), ref: "main" };
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--worktree") options.worktree = true;
      else if (["--repo", "--ref", "--plugin"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--")) options[args[i].slice(2)] = args[++i];
      else throw new Error("Usage: --repo PATH --plugin foreman|hush|razor [--ref main | --worktree]");
    }
    const repo = path.resolve(options.repo);
    let files, readme;
    if (options.worktree) {
      files = [...new Set(git(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean))].filter(f => fs.existsSync(path.join(repo, f)));
      readme = fs.readFileSync(path.join(repo, "README.md"), "utf8");
    } else {
      const sha = git(repo, ["rev-parse", "--verify", "--end-of-options", `${options.ref}^{commit}`]).trim();
      const entries = git(repo, ["ls-tree", "-r", "-z", sha]).split("\0").filter(Boolean);
      files = entries.map(entry => entry.slice(entry.indexOf("\t") + 1));
      if (entries.some(entry => !entry.startsWith("100644 blob "))) throw new Error("Main must contain ordinary documentation files, not symlinks, submodules or executable files.");
      readme = git(repo, ["show", `${sha}:README.md`]);
    }
    const errors = checkFiles(files, readme, options.plugin);
    if (errors.length) { for (const error of errors) console.error(error); return 1; }
    console.log(`${options.plugin}: documentation selector and maintenance CI passed.`);
    return 0;
  } catch (error) { console.error(`Main selector check failed: ${error.message}`); return 1; }
}
module.exports = { FILES, checkFiles, main };
if (require.main === module) process.exitCode = main();
