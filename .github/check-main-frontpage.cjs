#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const FILES = ["LICENSE", "README.md", "assets/logo-dark.svg", "assets/logo.svg", "assets/mascot.svg",
  ".github/check-main-frontpage.cjs", ".github/workflows/test.yml"];
const SHARED_SECTIONS = ["What is this?", "Why you'd want it", "How it works", "What you can do", "Good to know"];

function productSections(readme) {
  const text = readme.replace(/\r\n/g, "\n")
    .replace(/^<!-- foundry:platform ([a-z-]+) -->\n[\s\S]*?^<!-- \/foundry:platform \1 -->\n?/gm, "");
  const sections = {};
  const headings = [...text.matchAll(/^## (.+)\n/gm)];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    sections[h[1]] = text.slice(h.index + h[0].length, headings[i + 1]?.index ?? text.length).trim();
  }
  return sections;
}

function checkCommon(readme, claude, codex) {
  const main = productSections(readme), a = productSections(claude), b = productSections(codex);
  const errors = [];
  for (const heading of SHARED_SECTIONS) {
    if (!a[heading] || a[heading] !== b[heading]) errors.push(`Editions disagree on shared section: ${heading}`);
    if (main[heading] !== a[heading]) errors.push(`Main must preserve the shared section: ${heading}`);
  }
  const branding = text => {
    text = text.replace(/\r\n/g, '\n');
    return [text.match(/^<div align="center">[\s\S]*?^<\/div>/m)?.[0],
      text.split('\n').find(line => line.startsWith('> **TL;DR**')),
      text.match(/^<p align="center"><img src="assets\/mascot\.svg"[^\n]+/m)?.[0]];
  };
  const mainBrand = branding(readme), aBrand = branding(claude), bBrand = branding(codex);
  for (let i = 0; i < aBrand.length; i++) if (aBrand[i] || bBrand[i]) {
    if (aBrand[i] !== bBrand[i] || mainBrand[i] !== aBrand[i]) errors.push('Main and editions must preserve shared branding and summary.');
  }
  return errors;
}

function checkFiles(files, readme, plugin) {
  if (!["foreman", "hush", "razor"].includes(plugin)) throw new Error("Select foreman, hush or razor; Flint is outside this policy.");
  const errors = [];
  for (const file of files) if (!FILES.includes(file)) errors.push(`Unexpected main file: ${file}`);
  for (const file of FILES) if (!files.includes(file)) errors.push(`Missing main file: ${file}`);
  const sections = productSections(readme);
  for (const heading of SHARED_SECTIONS) if (!sections[heading]) errors.push(`Missing product overview section: ${heading}`);
  if (!/src="assets\/mascot\.svg"/.test(readme)) errors.push("Main must include the shared product animation.");
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
      else if (["--repo", "--ref", "--plugin", "--claude-ref", "--codex-ref"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--")) options[args[i].slice(2)] = args[++i];
      else throw new Error("Usage: --repo PATH --plugin foreman|hush|razor [--ref main | --worktree] [--claude-ref REF --codex-ref REF]");
    }
    const repo = path.resolve(options.repo);
    let files, readme, mainSha;
    if (options.worktree) {
      files = [...new Set(git(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean))].filter(f => fs.existsSync(path.join(repo, f)));
      readme = fs.readFileSync(path.join(repo, "README.md"), "utf8");
    } else {
      const sha = git(repo, ["rev-parse", "--verify", "--end-of-options", `${options.ref}^{commit}`]).trim();
      mainSha = sha;
      const entries = git(repo, ["ls-tree", "-r", "-z", sha]).split("\0").filter(Boolean);
      files = entries.map(entry => entry.slice(entry.indexOf("\t") + 1));
      if (entries.some(entry => !entry.startsWith("100644 blob "))) throw new Error("Main must contain ordinary documentation files, not symlinks, submodules or executable files.");
      readme = git(repo, ["show", `${sha}:README.md`]);
    }
    const errors = checkFiles(files, readme, options.plugin);
    if (options['claude-ref'] || options['codex-ref']) {
      if (!options['claude-ref'] || !options['codex-ref']) throw Error("Provide both edition refs for shared-content verification.");
      const refs = ['claude-ref', 'codex-ref'].map(key => git(repo, ['rev-parse', '--verify', '--end-of-options', `${options[key]}^{commit}`]).trim());
      errors.push(...checkCommon(readme, ...refs.map(ref => git(repo, ['show', `${ref}:README.md`]))));
      for (const asset of ['assets/logo.svg', 'assets/logo-dark.svg', 'assets/mascot.svg']) {
        const current = options.worktree ? fs.readFileSync(path.join(repo, asset), 'utf8') : git(repo, ['show', `${mainSha}:${asset}`]);
        const values = refs.map(ref => git(repo, ['show', `${ref}:${asset}`]));
        if (values.some(value => value.replace(/\r\n/g, '\n') !== current.replace(/\r\n/g, '\n'))) errors.push(`Main and both editions must share ${asset}`);
      }
    }
    if (errors.length) { for (const error of errors) console.error(error); return 1; }
    console.log(`${options.plugin}: documentation selector and maintenance CI passed.`);
    return 0;
  } catch (error) { console.error(`Main selector check failed: ${error.message}`); return 1; }
}
module.exports = { FILES, SHARED_SECTIONS, productSections, checkCommon, checkFiles, main };
if (require.main === module) process.exitCode = main();
