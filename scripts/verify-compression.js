#!/usr/bin/env node
"use strict";

// Mechanical gate for the compression flow, in two modes.
//
// `--target <original>` runs before anything is read or written: it prints
// the candidate path the run may write and refuses an unsupported format or
// a candidate file that already exists (that file can hold the user's own
// edits — nothing here may clobber it).
//
// `<original> <compressed>` runs after the candidate is written and reports
// everything the original's meaning rests on that didn't survive it.
//
// Both fail closed: a non-zero exit means the candidate is not ready to be
// swapped in. Neither mode writes anything.

const URL_RE = /https?:\/\/[^\s)]+/g;
const PATH_RE = /(?:\.\.?\/|\/|[A-Za-z]:\\)[\w\-./\\]+|[\w-]+(?:[/\\][\w\-./\\]+)+/g;
const HEADING_RE = /^(#{1,6})[ \t]+(.+)$/gm;
const FENCE_RE = /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const LINK_TARGET_RE = /\[[^\]]*\]\(\s*([^)\s]+)/g;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
// snake_case / CONST_CASE, camelCase, call(), $ENV_VAR.
const IDENTIFIER_RE =
  /\b(?:[A-Za-z0-9]+_[A-Za-z0-9_]+|[a-z0-9]+[A-Z][A-Za-z0-9]*|[A-Za-z_][\w$]*\(\))|\$[A-Za-z_][A-Za-z0-9_]*/g;
// Counted, not matched pairwise: compression rewords freely, but it must
// never add or drop a negation. `can't`/`won't` come in through the n't arm.
const NEGATION_RE =
  /\b(?:no|not|never|none|nothing|nowhere|neither|nor|without|cannot|avoid|(?:do|does|did|is|are|was|were|has|have|had|ca|wo|would|should|must|need|might)n['’]t)\b/gi;

const SUPPORTED_EXTENSIONS = [".md", ".markdown", ".txt"];

function matchSet(re, text) {
  return new Set([...text.matchAll(re)].map((m) => m[0]));
}

function extractHeadings(text) {
  return new Set([...text.matchAll(HEADING_RE)].map((m) => `${m[1]} ${m[2].trim()}`));
}

function extractCodeBlocks(text) {
  return new Set([...text.matchAll(FENCE_RE)].map((m) => m[3]));
}

function stripCodeBlocks(text) {
  return text.replace(FENCE_RE, "");
}

function extractInlineCode(text) {
  return new Set([...stripCodeBlocks(text).matchAll(INLINE_CODE_RE)].map((m) => m[1]));
}

function extractUrls(text) {
  return matchSet(URL_RE, text);
}

function extractPaths(text) {
  return matchSet(PATH_RE, text);
}

function extractLinkTargets(text) {
  return new Set([...text.matchAll(LINK_TARGET_RE)].map((m) => m[1]));
}

function extractNumbers(text) {
  return matchSet(NUMBER_RE, text);
}

function extractIdentifiers(text) {
  return matchSet(IDENTIFIER_RE, text);
}

function countNegations(text) {
  return [...text.matchAll(NEGATION_RE)].length;
}

function extractFrontmatter(text) {
  const m = text.match(FRONTMATTER_RE);
  return m ? m[0] : "";
}

// Frontmatter is copied, not compressed, so anything short of byte equality
// is a failure. Report the concrete lines when there are any to name.
function frontmatterLoss(originalText, compressedText) {
  const before = extractFrontmatter(originalText);
  const after = extractFrontmatter(compressedText);
  if (before === after) return [];
  const afterLines = new Set(after.split(/\r?\n/));
  const gone = before.split(/\r?\n/).filter((line) => !afterLines.has(line));
  return gone.length ? gone : ["frontmatter block is not byte-identical"];
}

function missing(before, after) {
  return [...before].filter((x) => !after.has(x));
}

function verify(originalText, compressedText) {
  const negationsBefore = countNegations(originalText);
  const negationsAfter = countNegations(compressedText);
  const result = {
    ok: true,
    missing: {
      frontmatter: frontmatterLoss(originalText, compressedText),
      headings: missing(extractHeadings(originalText), extractHeadings(compressedText)),
      codeBlocks: missing(extractCodeBlocks(originalText), extractCodeBlocks(compressedText)),
      urls: missing(extractUrls(originalText), extractUrls(compressedText)),
      paths: missing(extractPaths(originalText), extractPaths(compressedText)),
      inlineCode: missing(extractInlineCode(originalText), extractInlineCode(compressedText)),
      linkTargets: missing(extractLinkTargets(originalText), extractLinkTargets(compressedText)),
      numbers: missing(extractNumbers(originalText), extractNumbers(compressedText)),
      identifiers: missing(extractIdentifiers(originalText), extractIdentifiers(compressedText)),
      negations:
        negationsBefore === negationsAfter
          ? []
          : [`negation words: ${negationsBefore} in the original, ${negationsAfter} in the candidate`],
    },
  };
  result.ok = Object.values(result.missing).every((arr) => arr.length === 0);
  return result;
}

function candidatePath(originalPath) {
  const path = require("path");
  const base = path.basename(originalPath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return path.join(path.dirname(originalPath), `${stem}.hush${ext}`);
}

function targetCheck(originalPath, exists = (p) => require("fs").existsSync(p)) {
  const path = require("path");
  const candidate = candidatePath(originalPath);
  const ext = path.extname(originalPath).toLowerCase();
  const refusals = [];
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    refusals.push(
      `unsupported format ${ext || "(no extension)"}: only ${SUPPORTED_EXTENSIONS.join(", ")} files are compressed`
    );
  }
  if (exists(candidate)) {
    refusals.push(`candidate already exists: ${candidate} — refusing to overwrite it`);
  }
  return { ok: refusals.length === 0, original: originalPath, candidate, refusals };
}

function usage() {
  console.error(
    "Usage: verify-compression.js <original> <compressed>\n" +
      "       verify-compression.js --target <original>"
  );
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--target") {
    if (!args[1]) usage();
    const result = targetCheck(args[1]);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  const [originalPath, compressedPath] = args;
  if (!originalPath || !compressedPath) usage();
  const fs = require("fs");
  const originalText = fs.readFileSync(originalPath, "utf-8");
  const compressedText = fs.readFileSync(compressedPath, "utf-8");
  const result = verify(originalText, compressedText);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  verify,
  extractHeadings,
  extractCodeBlocks,
  extractUrls,
  extractPaths,
  extractInlineCode,
  extractFrontmatter,
  extractLinkTargets,
  extractNumbers,
  extractIdentifiers,
  countNegations,
  candidatePath,
  targetCheck,
  SUPPORTED_EXTENSIONS,
};
