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
const { execSync } = require("child_process");

// The minimum that reads as a nav rather than one stray cross-reference.
const MIN_LINKS = 3;

function repoRoot() {
  return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
}

// GitHub's own slug rule: lowercase, drop everything that is not a word
// character, whitespace or hyphen, then spaces to hyphens.
function slug(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
}

// Headings inside a fenced block are content, not sections -- flint's README
// quotes a reply whose ten `##` lines would otherwise register as anchors.
function headingSlugs(markdown) {
  const slugs = new Set();
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) slugs.add(slug(m[1]));
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

  for (const a of anchorsIn(markdown)) {
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

function stagedRootReadme(root) {
  const staged = execSync("git diff --cached --name-only", { cwd: root, encoding: "utf-8" })
    .split("\n")
    .filter(Boolean);
  return staged.includes("README.md") ? [path.join(root, "README.md")] : [];
}

// argv is a parameter, not read from process: the hooks that call this run it
// after another check has already rewritten process.argv.
function main(argv = process.argv.slice(2)) {
  const args = argv;
  let files;
  if (args[0] === "staged") files = stagedRootReadme(repoRoot());
  else if (args.length) files = args;
  else files = [path.join(repoRoot(), "README.md")];

  const problems = checkFiles(files);
  if (problems.length === 0) return 0;

  process.stderr.write("\nREADME nav check:\n\n");
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.stderr.write("\n");
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, slug, headingSlugs, anchorsIn, navRegion, checkMarkdown, checkFiles };
