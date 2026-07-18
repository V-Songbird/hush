#!/usr/bin/env node
"use strict";

// House rule: reference/competitor-project names may be named ONLY in README.md
// files — the plugins' marketing surface, where "beating the giants" framing is
// welcome. Everywhere else they must never reach a public record: other file
// contents (CHANGELOGs, manifests, code, tests), commit messages, anything that
// ships or gets pushed. The names themselves live ONLY in a private, gitignored
// blocklist this check reads at runtime; this script stays generic so it can be
// committed anywhere. Missing blocklist = fail-open (a standalone clone of a
// plugin repo has no private notes and must still be able to commit).
//
// Modes:
//   node check-reference-names.js staged        — scan staged added lines
//   node check-reference-names.js message <file> — scan a commit message file

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function loadBlocklist() {
  const candidates = [
    process.env.HOUSE_REFERENCE_BLOCKLIST,
    path.join(process.cwd(), "docs", "research", "reference-names.txt"),
    path.join(process.cwd(), "..", "docs", "research", "reference-names.txt"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const names = fs
        .readFileSync(p, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      if (names.length) return names;
    } catch {
      /* try next */
    }
  }
  return null;
}

// A README is the one public surface where competitor names are allowed. Match
// the basename (case-insensitively) so nested READMEs count too, mirroring the
// public-docs rule's **/README.md glob.
function isExemptPath(p) {
  return /(^|\/)readme\.md$/i.test(p);
}

// Pull the added lines out of a `git diff --cached --unified=0`, dropping any
// that land in an exempt (README) file. The `+++ b/<path>` header marks which
// file the following `+` lines belong to; `+++ /dev/null` marks a deletion.
function addedLinesFromDiff(diff) {
  const added = [];
  let exempt = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      exempt = isExemptPath(line.slice(4).replace(/^b\//, ""));
      continue;
    }
    // Drop diff headers (+++). An added content line whose own text starts with
    // "+++" is dropped too — same false-negative the join filter always had.
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+") && !exempt) added.push(line);
  }
  return added.join("\n");
}

function scanText(text, names, label) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    for (const name of names) {
      // Word-ish boundary check so short names don't match inside ordinary
      // words (the blocklist may contain e.g. a 4-letter all-caps name that
      // is also an English substring).
      const re = new RegExp("(^|[^a-z0-9])" + name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9])");
      if (re.test(lower)) hits.push(`${label}:${i + 1}: contains "${name}"`);
    }
  }
  return hits;
}

function main() {
  const names = loadBlocklist();
  if (!names) return 0; // no private blocklist available — fail open
  const mode = process.argv[2];
  let hits = [];
  if (mode === "message") {
    let text = "";
    try {
      text = fs.readFileSync(process.argv[3], "utf8");
    } catch {
      return 0;
    }
    hits = scanText(text, names, "commit message");
  } else {
    let diff = "";
    try {
      diff = execFileSync("git", ["diff", "--cached", "--unified=0"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      return 0;
    }
    hits = scanText(addedLinesFromDiff(diff), names, "staged change");
  }
  if (hits.length) {
    console.error("reference-name check: private reference-project names may appear only in README.md, never in any other public record.");
    for (const h of hits.slice(0, 20)) console.error("  " + h);
    console.error("Reword generically (\"a rival tool\", \"a public reference\"), move the detail to gitignored docs/research/, or — if it's marketing copy — put it in the README.");
    return 1;
  }
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main, scanText, loadBlocklist, isExemptPath, addedLinesFromDiff };
