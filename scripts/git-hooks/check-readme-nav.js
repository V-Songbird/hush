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

// The lines outside code blocks. A code block is content, not structure. Each
// code line becomes a blank one, so a block still ends a paragraph and no code
// span can open before it and close after it.
//
// A backtick fence's info string holds no backtick, so "```x``` text" is a
// line of text. An indented block opens after a blank line, four columns past
// the content of the innermost list item it sits in, if any. An item opens
// within three columns of that content, so it can nest; an item ends the lists
// indented past it, and a less indented line after a blank one ends the lists
// whose content it does not reach. A paragraph's lazy continuation is never
// code.
function linesOutsideFences(markdown) {
  const lines = [], lists = [];
  let fence = null, code = false, blank = true;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker && (fence || marker[1][0] === "~" || !marker[2].includes("`"))) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      lines.push("");
      code = false;
      blank = true;
      continue;
    }
    if (fence) { lines.push(""); continue; }
    const indent = line.replace(/\t/g, "    ").search(/\S/);
    if (indent === -1) { lines.push(line); blank = true; continue; }
    if ((code || blank) && indent >= (lists.at(-1) ?? 0) + 4) { lines.push(""); code = true; continue; }
    const item = line.match(/^( *)([-+*]|\d{1,9}[.)])( {1,4})\S/);
    if (item || blank) while (indent < lists.at(-1)) lists.pop();
    if (item && indent <= (lists.at(-1) ?? 0) + 3) lists.push(indent + item[2].length + item[3].length);
    lines.push(line);
    code = blank = false;
  }
  return lines;
}

// A link written in code is an example, not a link -- hush's voice shows the
// app's `[title](#terminal/<id>)` form, which no heading could ever match.
// An inline span opens on a whole backtick run and closes on a run of exactly
// its length, within a paragraph. A backslash-escaped backtick is text, and a
// run with no closer is text. A removed span leaves a space, so [a]`x`(#b)
// does not turn into a link.
//
// An HTML <code> element hides Markdown only inside an HTML block, which opens
// on a line that starts with a block-level tag, or holds one tag alone, and
// ends at a blank line; elsewhere GitHub renders a [label](#x) in it as a live
// link. An <a href> is live in either place, so only its href stays. The
// innermost element goes first, so a nested one leaves its parent whole, and
// one with no closer within its block is text.
const CODE_SPAN = /\\[\\`]|(`+)(?!`)(?:[^\n]|\n(?!\s*\n))*?(?<!`)\1(?!`)|`+/g;
const CODE_ELEMENT = /<code(?=[\s>])[^>]*>(?:(?!<\/?code[\s>])(?:[^\n]|\n(?!\s*\n)))*<\/code\s*>/gi;
const HTML_BLOCK = new RegExp("^ {0,3}(?:<\\/?(?:address|article|aside|base|basefont|blockquote|body|caption|" +
  "center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|" +
  "frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|" +
  "option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\\s/>]|$)|" +
  "<\\/?[a-z][a-z\\d-]*(?:\\s[^<>]*)?\\/?>\\s*$)", "i");
function withoutCode(markdown) {
  let text = linesOutsideFences(markdown).join("\n").replace(CODE_SPAN, (match, run) => (run ? " " : match));
  const hrefsInHtmlBlock = (element, at, whole) =>
    HTML_BLOCK.test((whole.slice(0, at) + element).split(/\n\s*\n/).pop().replace(/^\n+/, "").split("\n")[0])
      ? ` ${(element.match(/href="[^"]*"/g) || []).join(" ")} `
      : element.replace(/<\/?code\b/gi, (tag) => tag.replace("<", "&lt;"));
  for (let prev; prev !== text;) [prev, text] = [text, text.replace(CODE_ELEMENT, hrefsInHtmlBlock)];
  return text;
}

// Headings inside a fenced block are content, not sections -- flint's README
// quotes a reply whose ten `##` lines would otherwise register as anchors.
function headingSlugs(markdown) {
  const slugs = new Set();
  for (const line of linesOutsideFences(markdown)) {
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
  markdown = withoutCode(markdown);
  const found = [];
  for (const m of markdown.matchAll(/href="#([^"]+)"/g)) found.push(m[1]);
  for (const m of markdown.matchAll(/\]\(#([^)]+)\)/g)) found.push(m[1]);
  return found;
}

// Links to another page's anchor, as [page, anchor] pairs: [x](other.md#a) or
// href="../README.md#a". A URL or a root-relative path has no page here to read.
function linkedAnchorsIn(markdown) {
  markdown = withoutCode(markdown);
  const found = [];
  for (const m of markdown.matchAll(/(?:href="|\]\()(?![a-z][a-z\d+.-]*:|\/)([^"()#\s]+\.md)#([^")\s]+)/gi)) {
    found.push([m[1], m[2]]);
  }
  return found;
}

// "Under the badges" in practice means before the page's own first section.
// A "## " line inside a fenced block is an example, not that section.
function navRegion(markdown) {
  const lines = linesOutsideFences(markdown);
  const firstSection = lines.findIndex((l) => /^ {0,3}##\s+/.test(l));
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
