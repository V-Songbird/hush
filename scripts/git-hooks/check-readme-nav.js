#!/usr/bin/env node
"use strict";

// House rule: every public front page carries a nav line under the badges, so
// a reader who only wants the install steps does not scroll the whole pitch.
//
// The half a human reviewer cannot hold: GitHub builds a heading's anchor from
// its TEXT, so renaming a section silently breaks every link pointing at it,
// from the same page or from another one. Nothing warns you -- the link just
// scrolls nowhere. This resolves every in-page anchor, and every relative link
// to another page's anchor (other.md#section), against the headings actually
// in the target page.
//
//   node check-readme-nav.js                  -- every Markdown file Git tracks
//   node check-readme-nav.js staged           -- the same, from the index, if a .md file is staged
//   node check-readme-nav.js a.md b.md        -- those files
//
// The nav is required of the ROOT README.md only, or of a README.md named on
// the command line. Benchmark and fixture READMEs are reference pages for
// someone already deep in the repo; a nav on them is noise, and requiring one
// would be a rule nobody could defend. Their anchors still have to resolve.

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

// Links to another page's anchor, as [page, anchor] pairs: [x](other.md#a) or
// href="../README.md#a". A URL or a root-relative path has no page here to read.
function linkedAnchorsIn(markdown) {
  const found = [];
  for (const m of markdown.matchAll(/(?:href="|\]\()(?![a-z][a-z\d+.-]*:|\/)([^"()#\s]+\.md)#([^")\s]+)/gi)) {
    found.push([m[1], m[2]]);
  }
  return found;
}

// "Under the badges" in practice means before the page's own first section.
function navRegion(markdown) {
  const lines = markdown.split(/\r?\n/);
  const firstSection = lines.findIndex((l) => /^##\s+/.test(l));
  return (firstSection === -1 ? lines : lines.slice(0, firstSection)).join("\n");
}

// readLinked(page) returns a linked page's text, or null when it does not
// exist; without it, links to other pages go unchecked.
function checkMarkdown(markdown, label, { nav = true, readLinked } = {}) {
  const problems = [];
  const heads = headingSlugs(markdown);

  if (nav && anchorsIn(navRegion(markdown)).length < MIN_LINKS) {
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

  for (const [target, encoded] of readLinked ? linkedAnchorsIn(markdown) : []) {
    let page, a;
    try { page = decodeURIComponent(target); a = decodeURIComponent(encoded); }
    catch { problems.push(`${label}: invalid encoded link ${target}#${encoded}`); continue; }
    const linked = readLinked(page);
    if (linked === null) {
      problems.push(`${label}: "${page}#${a}" points at a page that does not exist.`);
    } else if (!headingSlugs(linked).has(a)) {
      problems.push(
        `${label}: "${page}#${a}" matches no heading in ${page}. GitHub builds anchors from heading ` +
          `text, so renaming a section breaks its link with no warning.`
      );
    }
  }
  return problems;
}

// read(page) returns a page's text, or null when it does not exist. A page's
// links are read the same way, from the page's own directory.
function checkPages(pages, read, needsNav, suffix = "") {
  const problems = [];
  for (const page of pages) {
    const text = read(page);
    if (text === null) continue;
    const readLinked = (target) => read(path.join(path.dirname(page), target).split(path.sep).join("/"));
    problems.push(...checkMarkdown(text, page + suffix, { nav: needsNav(page), readLinked }));
  }
  return problems;
}

function readFile(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
}

function trackedPages(root) {
  return execFileSync("git", ["ls-files", "-z", "--", "*.md"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
}

// A renamed heading breaks links in pages that are not staged, so any staged
// Markdown file, a deleted one included, checks every tracked page.
function checkStaged(root) {
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--no-renames", "-z"],
    { cwd: root, encoding: "utf8" }).split("\0");
  if (!staged.some((f) => f.endsWith(".md"))) return [];
  const show = (page) => {
    try { return execFileSync("git", ["show", `:${page}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
    catch { return null; }
  };
  return checkPages(trackedPages(root), show, (page) => page === "README.md", " (staged)");
}

// argv is a parameter, not read from process: the hooks that call this run it
// after another check has already rewritten process.argv.
function main(argv = process.argv.slice(2)) {
  const args = argv;
  let problems;
  if (args[0] === "staged") problems = checkStaged(repoRoot());
  else if (args.length) problems = checkPages(args, readFile, (f) => path.basename(f) === "README.md");
  else {
    const root = repoRoot();
    problems = checkPages(trackedPages(root), (page) => readFile(path.join(root, page)), (page) => page === "README.md");
  }
  if (problems.length === 0) return 0;

  process.stderr.write("\nMarkdown nav and anchor check:\n\n");
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.stderr.write("\n");
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, slug, headingSlugs, anchorsIn, linkedAnchorsIn, navRegion, checkMarkdown, checkPages, checkStaged };
