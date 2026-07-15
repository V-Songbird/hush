#!/usr/bin/env node
"use strict";

// House rule: reference-project names never reach public records — file
// contents, commit messages, anything that ships or gets pushed. The names
// themselves live ONLY in a private, gitignored blocklist this check reads
// at runtime; this script stays generic so it can be committed anywhere.
// Missing blocklist = fail-open (a standalone clone of a plugin repo has no
// private notes and must still be able to commit).
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
    const added = diff
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .join("\n");
    hits = scanText(added, names, "staged change");
  }
  if (hits.length) {
    console.error("reference-name check: private reference-project names must never reach public records.");
    for (const h of hits.slice(0, 20)) console.error("  " + h);
    console.error("Reword generically (\"a rival tool\", \"a public reference\") or move the detail to gitignored docs/research/.");
    return 1;
  }
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main, scanText, loadBlocklist };
