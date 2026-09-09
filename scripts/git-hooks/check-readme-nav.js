#!/usr/bin/env node
"use strict";

// House rule: every public front page carries a nav line under the badges, so
// a reader who only wants the install steps does not scroll the whole pitch.
//
// The half a human reviewer cannot hold: GitHub builds a heading's anchor from
// its TEXT, so renaming a section silently breaks the nav link pointing at it.
// Nothing warns you -- the link just scrolls nowhere. This resolves every
// in-page anchor against the headings actually in the file.
//
//   node check-readme-nav.js                  -- this repo's root README.md
//   node check-readme-nav.js staged           -- only if README.md is staged
//   node check-readme-nav.js a.md b.md        -- those files
//
// Scope is each repo's ROOT README.md on purpose. Benchmark and fixture
// READMEs are reference pages for someone already deep in the repo; a nav on
// them is noise, and requiring one would be a rule nobody could defend.

const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
const slugCharacters = require("./vendor/github-slugger-regex");

// The minimum that reads as a nav rather than one stray cross-reference.
const MIN_LINKS = 3;

function repoRoot() {
  return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
}

// Preserve Unicode letters and each literal space: removing an em dash
// between two spaces must leave two hyphens, not collapse them into one.
function slug(text) {
  return text.toLowerCase().replace(slugCharacters, "").replace(/ /g, "-");
}

// Headings inside a fenced block are content, not sections -- flint's README
// quotes a reply whose ten `##` lines would otherwise register as anchors.
function headingSlugs(markdown) {
  const slugs = new Set();
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const m = line.match(/^ {0,3}#{1,6}\s+(.*)$/);
    if (m) {
      const text = m[1].replace(/\s+#+\s*$/, "").replace(/<[^>]+>/g, "")
        .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1");
      const base = slug(text.trim());
      let anchor = base, suffix = 0;
      while (slugs.has(anchor)) anchor = `${base}-${++suffix}`;
      slugs.add(anchor);
    }
  }
  return slugs;
}

// Both spellings count: <a href="#x"> in the centered HTML block, and a plain
// markdown [label](#x) elsewhere in the page.
function anchorsIn(markdown) {
  const found = [];
  for (const m of markdown.matchAll(/href="#([^"]+)"/g)) found.push(m[1]);
  for (const m of markdown.matchAll(/\]\(#([^)]+)\)/g)) found.push(m[1]);
  return found;
}

// "Under the badges" in practice means before the page's own first section.
function navRegion(markdown) {
  const lines = markdown.split(/\r?\n/);
  const firstSection = lines.findIndex((l) => /^##\s+/.test(l));
  return (firstSection === -1 ? lines : lines.slice(0, firstSection)).join("\n");
}

function checkMarkdown(markdown, label) {
  const problems = [];
  const heads = headingSlugs(markdown);

  const navLinks = anchorsIn(navRegion(markdown));
  if (navLinks.length < MIN_LINKS) {
    problems.push(
      `${label}: no nav line. Put ${MIN_LINKS} or more in-page links above the first "## " section, ` +
        `so a reader can jump straight to the part they came for.`
    );
  }

  for (const encoded of anchorsIn(markdown)) {
    let a;
    try { a = decodeURIComponent(encoded); }
    catch { problems.push(`${label}: invalid encoded anchor #${encoded}`); continue; }
    if (!heads.has(a)) {
      problems.push(
        `${label}: "#${a}" matches no heading in this file. GitHub builds anchors from heading ` +
          `text, so renaming a section breaks its link with no warning.`
      );
    }
  }
  return problems;
}

function checkFiles(files) {
  const problems = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    problems.push(...checkMarkdown(fs.readFileSync(f, "utf-8"), path.basename(f)));
  }
  return problems;
}

function checkStagedReadme(root) {
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=ACM", "-z", "--", "README.md"],
    { cwd: root, encoding: "utf8" }).split("\0");
  if (!staged.includes("README.md")) return [];
  const text = execFileSync("git", ["show", ":README.md"], { cwd: root, encoding: "utf8" });
  return checkMarkdown(text, "README.md (staged)");
}

// argv is a parameter, not read from process: the hooks that call this run it
// after another check has already rewritten process.argv.
function main(argv = process.argv.slice(2)) {
  const args = argv;
  const problems = args[0] === "staged" ? checkStagedReadme(repoRoot())
    : checkFiles(args.length ? args : [path.join(repoRoot(), "README.md")]);
  if (problems.length === 0) return 0;

  process.stderr.write("\nREADME nav check:\n\n");
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.stderr.write("\n");
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, slug, headingSlugs, anchorsIn, navRegion, checkMarkdown, checkFiles, checkStagedReadme };
