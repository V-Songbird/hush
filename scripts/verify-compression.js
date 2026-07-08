#!/usr/bin/env node
"use strict";

// Mechanical check that a compressed memory file didn't lose anything
// structural. Never blocks or retries anything — the skill that calls this
// never writes to the original file, so there's no destructive path to
// guard here. It just tells the user what to double-check before they
// manually swap the compressed file in.

const URL_RE = /https?:\/\/[^\s)]+/g;
const PATH_RE = /(?:\.\.?\/|\/|[A-Za-z]:\\)[\w\-./\\]+|[\w-]+(?:[/\\][\w\-./\\]+)+/g;
const HEADING_RE = /^(#{1,6})[ \t]+(.+)$/gm;
const FENCE_RE = /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm;
const INLINE_CODE_RE = /`([^`\n]+)`/g;

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

function missing(before, after) {
  return [...before].filter((x) => !after.has(x));
}

function verify(originalText, compressedText) {
  const result = {
    ok: true,
    missing: {
      headings: missing(extractHeadings(originalText), extractHeadings(compressedText)),
      codeBlocks: missing(extractCodeBlocks(originalText), extractCodeBlocks(compressedText)),
      urls: missing(extractUrls(originalText), extractUrls(compressedText)),
      paths: missing(extractPaths(originalText), extractPaths(compressedText)),
      inlineCode: missing(extractInlineCode(originalText), extractInlineCode(compressedText)),
    },
  };
  result.ok = Object.values(result.missing).every((arr) => arr.length === 0);
  return result;
}

function main() {
  const [originalPath, compressedPath] = process.argv.slice(2);
  if (!originalPath || !compressedPath) {
    console.error("Usage: verify-compression.js <original> <compressed>");
    process.exit(1);
  }
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
};
