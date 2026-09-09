#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const KEYS = ["identity", "install", "commands", "compatibility", "benchmarks", "links"];
const HEADINGS = ["What is this?", "Why you'd want it", "How it works", "Install", "What you can do", "The numbers", "Going deeper", "Good to know", "License"];

function parseReadme(input, expected) {
  const text = input.replace(/\r\n/g, "\n");
  const editions = [...text.matchAll(/^<!-- foundry:edition (Claude|Codex) -->$/gm)];
  if (editions.length !== 1) throw new Error("Exactly one Claude or Codex edition marker is required.");
  const edition = editions[0][1];
  if (expected && edition.toLowerCase() !== expected.toLowerCase()) throw new Error(`Expected ${expected}, found ${edition}.`);
  if (expected && !["Claude", "Codex"].some(p => p.toLowerCase() === expected.toLowerCase())) throw new Error("Unknown expected platform.");
  const sections = {}, common = [], order = [];
  let active = null;
  for (const line of text.split("\n")) {
    const start = line.match(/^<!-- foundry:platform ([a-z-]+) -->$/);
    const end = line.match(/^<!-- \/foundry:platform ([a-z-]+) -->$/);
    if (start) {
      if (active || !KEYS.includes(start[1]) || sections[start[1]]) throw new Error(`Invalid, nested or duplicate exception: ${start[1]}`);
      active = start[1]; sections[active] = []; order.push(active); common.push(line); continue;
    }
    if (end) {
      if (end[1] !== active) throw new Error("Mismatched exception closing marker.");
      active = null; common.push(line); continue;
    }
    if (/foundry:platform/.test(line)) throw new Error("Malformed exception marker.");
    if (active) {
      if (/^#{1,2}\s/.test(line)) throw new Error("Main headings must remain outside platform exceptions.");
      sections[active].push(line);
    } else common.push(line.replace(/^<!-- foundry:edition (Claude|Codex) -->$/, "<!-- foundry:edition shared -->"));
  }
  if (active || KEYS.some(key => !sections[key])) throw new Error("All six bounded exception blocks must be present and closed.");
  const shared = common.join("\n");
  for (const heading of HEADINGS) if (!shared.includes(`\n## ${heading}\n`)) throw new Error(`Missing shared section: ${heading}`);
  const bench = sections.benchmarks.join("\n");
  const evidenceTags = [...bench.matchAll(/^<!-- foundry:evidence (.+) -->$/gm)];
  if (evidenceTags.length !== 1) throw new Error("One benchmark evidence declaration is required.");
  const evidence = JSON.parse(evidenceTags[0][1]);
  if (evidence.platform !== edition) throw new Error("Benchmark evidence belongs to a different platform.");
  if (!["measured", "pending"].includes(evidence.status)) throw new Error("Benchmark status must be measured or pending.");
  if (evidence.status === "measured" && (!Array.isArray(evidence.models) || !evidence.models.length || !evidence.models.every(m => typeof m === "string" && m.trim()) || typeof evidence.source !== "string" || !evidence.source.trim() || typeof evidence.date !== "string" || !evidence.date)) throw new Error("Measured results need models, a source and a date.");
  if (evidence.status === "measured" && !/^\d{4}-\d{2}-\d{2}$/.test(evidence.date) && !(evidence.date === "unknown" && evidence.dateReason)) throw new Error("Use a source date or explicitly explain why it is unknown; a review date is not a run date.");
  if (evidence.status === "pending" && (typeof evidence.reason !== "string" || !evidence.reason.trim())) throw new Error("Pending measurements need a reason.");
  const tableLines = bench.split("\n").filter(line => /^\|.*\|$/.test(line));
  if (tableLines.length < 3) throw new Error("Keep the comparison table even when measurements are pending.");
  const cells = line => line.slice(1, -1).split("|").map(cell => cell.trim());
  const columns = cells(tableLines[0]);
  if (columns[0] !== "Model" || columns[1] !== "Setup") throw new Error("Benchmark tables must identify Model and Setup first.");
  if (!cells(tableLines[1]).every(cell => /^:?-{3,}:?$/.test(cell))) throw new Error("Invalid benchmark table separator.");
  for (const row of tableLines.slice(2)) {
    const values = cells(row);
    if (values.length !== columns.length) throw new Error("Benchmark table columns differ between rows.");
    if (evidence.status === "measured" && !evidence.models.includes(values[0])) throw new Error("A benchmark row uses an undeclared model.");
    if (evidence.status === "pending" && values.slice(2).some(value => /\d/.test(value))) throw new Error("Pending performance results cannot contain numerical measurements.");
  }
  return { edition, shared, columns, order, evidence };
}

function compare(left, right) {
  const a = parseReadme(left), b = parseReadme(right);
  if (a.edition === b.edition) throw new Error("Compare one Claude edition and one Codex edition.");
  if (a.shared !== b.shared) throw new Error("Shared README content differs outside the six platform exceptions.");
  if (JSON.stringify(a.columns) !== JSON.stringify(b.columns)) throw new Error("Benchmark comparison columns differ between editions.");
  return { commonBytes: Buffer.byteLength(a.shared), editions: [a.edition, b.edition] };
}

function readGit(repo, ref) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const run = args => execFileSync("git", ["-C", repo, ...args], {env, encoding:"utf8", stdio:["ignore","pipe","pipe"],maxBuffer:4*1024*1024});
  const sha = run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
  return run(["show", `${sha}:README.md`]);
}

function main(args = process.argv.slice(2)) {
  try {
    let expected;
    const expectAt = args.indexOf("--expect");
    if (expectAt !== -1) { expected = args[expectAt + 1]; if (!expected) throw new Error("Missing --expect platform."); args = [...args.slice(0,expectAt), ...args.slice(expectAt+2)]; }
    if (args[0] === "--check" && args.length === 2) {
      const parsed = parseReadme(fs.readFileSync(args[1],"utf8"),expected);
      console.log(`${parsed.edition} README structure and benchmark declaration passed.`);
    } else if (args[0] === "--pair" && args.length === 3) {
      const result = compare(fs.readFileSync(args[1],"utf8"),fs.readFileSync(args[2],"utf8"));
      console.log(`README pair passed (${result.commonBytes} shared bytes; matching benchmark columns).`);
    } else if (args[0] === "--git-pair" && args.length === 4) {
      compare(readGit(args[1],args[2]),readGit(args[1],args[3]));
      console.log(`README pair passed for ${args[1]}: ${args[2]} / ${args[3]}.`);
    } else if (args[0] === "--help") {
      console.log("Usage: --check README.md [--expect Claude|Codex]\n       --pair CLAUDE_README CODEX_README\n       --git-pair REPO CLAUDE_REF CODEX_REF\n\nChecks structure, exact shared content and benchmark declarations. Source accuracy and the justification for each exception require review.");
    } else throw new Error("Use --check, --pair, --git-pair or --help.");
    return 0;
  } catch (error) { console.error(`README coordination failed: ${error.message}`); return 1; }
}
module.exports = {parseReadme, compare, main};
if (require.main === module) process.exitCode = main();
