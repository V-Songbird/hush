#!/usr/bin/env node
"use strict";

// Fails a pull request whose added lines, added paths, commit messages, title
// or body contain an entry of the private list in PRIVATE_DETAILS. The list
// holds one literal, case-insensitive value per line; an entry's number is its
// line. Output names that number and where it matched, never the value, so
// nothing here may print a diff line, a path or a commit message.
//
// With no list, as on a fork or Dependabot pull request, the run is reported
// as unchecked and exits 0. Exit 1 is a match, exit 2 a run that could not read
// the pull request. The idea comes from roost (MIT); the code is written fresh.

const fs = require("fs");
const { execFileSync } = require("child_process");

const list = String(process.env.PRIVATE_DETAILS || "");
delete process.env.PRIVATE_DETAILS;

const entries = list
  .split(/\r?\n/)
  .map((line, index) => ({ entry: index + 1, value: line.trim().toLowerCase() }))
  .filter(({ value }) => value);

function report(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line.replace(/^::\w+ title=[^:]*::/, "")}\n`);
  }
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function addedLines(diff) {
  let inHunk = false;
  const added = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) inHunk = false;
    else if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && line.startsWith("+")) added.push(line.slice(1));
  }
  return added.join("\n");
}

if (!entries.length) {
  report("::warning title=Private details unchecked::UNCHECKED: this run has no private list, so nothing was scanned.");
  process.exit(0);
}

const { BASE_SHA: base = "", HEAD_SHA: head = "", PR_TITLE: title = "", PR_BODY: body = "" } = process.env;
const sha = /^[0-9a-f]{40,64}$/;

let sources;
try {
  if (!sha.test(base) || !sha.test(head)) throw new Error("bad revision");
  sources = [
    ["an added line", addedLines(git("diff", "--no-ext-diff", "--no-color", "--text", "--unified=0", `${base}...${head}`))],
    ["an added path", git("diff", "--name-only", "-z", "--diff-filter=ACR", `${base}...${head}`)],
    ["a commit message", git("log", "--format=%B", `${base}..${head}`)],
    ["the title", title],
    ["the body", body],
  ].map(([kind, text]) => [kind, text.toLowerCase()]);
} catch {
  report("::error title=Private details not scanned::The pull request could not be read, so nothing was scanned.");
  process.exit(2);
}

let found = false;
for (const { entry, value } of entries) {
  for (const [kind, text] of sources) {
    if (text.includes(value)) {
      found = true;
      report(`::error title=Private detail found::Entry ${entry} of the private list matched in ${kind}.`);
    }
  }
}

if (found) process.exit(1);
report(`No private detail found: scanned for ${entries.length} entries.`);
