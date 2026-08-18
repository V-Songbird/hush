#!/usr/bin/env node
"use strict";

// Mechanical check that a crafted output style kept hush's mechanics.
// Reports what didn't survive and exits 1 — it never edits anything.
// Everything except CORE_PHRASES, GUARDED_SECTIONS and the two markers is
// derived from the canonical file at run time; those lists are literal and
// must be re-checked whenever output-styles/hush.md is reworded.

// Sections whose RULES must survive a voice rewrite. They are checked by the
// anchors the rules are made of — the numbers, the inline code, the bolded
// caps, the count of listed exceptions, the shape-table rows — not byte for
// byte. A style that keeps these sections in stock's plain English teaches the
// reply plain English, whatever the Register section asks for, so the prose
// around the anchors has to stay the author's to rewrite.
const GUARDED_SECTIONS = ["Mid-turn silence", "Thoroughness", "Never compress", "Final message"];

// A rewrite may tighten prose. Losing a third of a section is losing a rule.
const WORD_FLOOR = 0.6;

// The exact sentences pick-style and craft-style key on. A description that
// only says "unmeasured" passes every other check and is then invisible to
// both, so the marker is checked here rather than trusted.
const CRAFTED_MARKER = "Unmeasured variant of Hush.";
const PRESET_MARKER = "Unmeasured preset shipped with Hush.";

// The core contract holds in every mode — full mode checks the readability
// frame on top of these phrases, never instead of them.
const CORE_PHRASES = [
  "Emit no text between tool calls",
  "quoted exact",
  "verbatim",
  "never the work",
];

function normalize(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { frontmatter: null, body: text };
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

function parseFrontmatter(raw) {
  const out = {};
  if (!raw) return out;
  for (const line of raw.split("\n")) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function sections(body) {
  const out = {};
  for (const part of body.split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    out[part.slice(0, nl).trim()] = part.slice(nl + 1).trim();
  }
  return out;
}

function paragraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function words(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// The worked example is the one part a style MUST rewrite — it is the only
// reply the file shows, and the reply copies it. So it contributes no anchors:
// drop the ✗ line, the ✓ lead-in, and the quoted block before reading them.
function rulesOnly(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*[>✗✓]/.test(line))
    .join("\n");
}

function anchors(sectionBody) {
  const rules = rulesOnly(sectionBody);
  const rows = rules.match(/^\|.*\|$/gm) || [];
  return {
    code: rules.match(/`[^`\n]+`/g) || [],
    bold: rules.match(/\*\*[^*\n]+\*\*/g) || [],
    numbers: [...new Set(rules.match(/(?<![\w.])\d+(?![\w.])/g) || [])],
    ordered: (rules.match(/^\d+\. /gm) || []).length,
    blocks: paragraphs(rules).length,
    // The header row names the columns and is the author's to reword. The data
    // rows name the shapes, and the shape names are the rule.
    rows: rows.slice(2).map((r) => r.split("|")[1].trim()),
  };
}

// `core: true` — for a style built on the stripped frame (maximum compression
// at the user's explicit request). Checks only the core contract: silence,
// thoroughness-over-report, never-compress essentials, the telemetry and hook
// paragraphs. The readability frame (headings, shape table, caps, paragraph
// structure) is deliberately not checked in that mode.
function verify(canonicalText, generatedText, { core = false } = {}) {
  const problems = [];
  const canonical = splitFrontmatter(normalize(canonicalText));
  const generated = splitFrontmatter(normalize(generatedText));

  if (generated.frontmatter === null) {
    problems.push("frontmatter: missing");
  } else {
    const fm = parseFrontmatter(generated.frontmatter);
    if (!fm.name) problems.push("frontmatter: name is missing");
    if (fm["keep-coding-instructions"] !== "true")
      problems.push("frontmatter: keep-coding-instructions must be true");
    if ("force-for-plugin" in fm)
      problems.push("frontmatter: force-for-plugin must not be copied");
    const description = (fm.description || "").trim();
    if (!description.endsWith(CRAFTED_MARKER) && !description.endsWith(PRESET_MARKER))
      problems.push(`frontmatter: description must end with the unmeasured marker "${CRAFTED_MARKER}" (crafted) or "${PRESET_MARKER}" (shipped preset)`);
  }

  const canSections = sections(canonical.body);

  // Everything above the first heading is preamble. Its first line is the
  // one-message-per-turn rule and is a mechanic; the lines after it are the
  // opening voice and stay rewritable.
  const openingRule = (canonical.body.split(/^## /m)[0] || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (openingRule && !generated.body.includes(openingRule))
    problems.push(`opening rule missing: ${openingRule.slice(0, 60)}`);

  for (const phrase of CORE_PHRASES) {
    if (!generated.body.includes(phrase)) problems.push(`core phrase missing: ${phrase}`);
  }

  if (!core) {
    const genSections = sections(generated.body);

    for (const name of Object.keys(canSections)) {
      if (!generated.body.includes(`## ${name}`))
        problems.push(`heading "## ${name}" is missing`);
    }

    for (const name of GUARDED_SECTIONS) {
      const body = canSections[name];
      if (!body) {
        problems.push(`canonical: section "${name}" not found`);
        continue;
      }
      const rewritten = genSections[name];
      if (rewritten === undefined) continue; // the missing-heading check above owns this
      const where = `section "${name}"`;
      const want = anchors(body);
      const got = anchors(rewritten);
      for (const kind of ["code", "bold", "numbers"]) {
        for (const anchor of want[kind]) {
          if (!rewritten.includes(anchor))
            problems.push(`${where}: ${kind} anchor dropped: ${anchor.slice(0, 50)}`);
        }
      }
      if (got.ordered < want.ordered)
        problems.push(`${where}: ${want.ordered} listed items became ${got.ordered}`);
      for (const cell of want.rows) {
        // Match the cell as a row opener, not as a bare substring — a rule
        // bullet elsewhere in the section may reuse the same words.
        const rowRe = new RegExp(`^\\|\\s*${cell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
        if (!rowRe.test(rewritten)) problems.push(`${where}: table row "${cell}" dropped`);
      }
      // Paragraph for paragraph. A rule that got reworded still occupies a block;
      // a rule that got deleted takes its block with it, and the word floor alone
      // is loose enough to let one through.
      if (got.blocks < want.blocks)
        problems.push(`${where}: ${want.blocks} paragraphs became ${got.blocks}`);
      const floor = Math.ceil(WORD_FLOOR * words(body));
      if (words(rewritten) < floor)
        problems.push(`${where}: ${words(rewritten)} words is under the ${floor}-word floor`);
    }
  }

  for (const para of paragraphs(canSections["Register"] || "")) {
    if (para.includes("[hush") || para.startsWith("Hook-injected")) {
      if (!generated.body.includes(para))
        problems.push(`Register clause missing: ${para.slice(0, 60)}`);
    }
  }

  // The self-narration ban is the one Register rule a voice may reword but not
  // drop. Its quoted openers are what give it teeth, so they are the anchor —
  // the sentence around them stays the author's to rewrite.
  for (const quoted of (canSections["Register"] || "").match(/"[^"]+\.\.\."/g) || []) {
    if (!generated.body.includes(quoted))
      problems.push(`Register no-self-narration example missing: ${quoted}`);
  }

  return { ok: problems.length === 0, problems };
}

const verifyCore = (canonicalText, generatedText) => verify(canonicalText, generatedText, { core: true });

function main() {
  const args = process.argv.slice(2);
  const core = args.includes("--core");
  const [canonicalPath, generatedPath] = args.filter((a) => a !== "--core");
  if (!canonicalPath || !generatedPath) {
    console.error("Usage: verify-style.js <canonical-hush.md> <generated-style.md> [--core]");
    process.exit(1);
  }
  const fs = require("fs");
  const check = core ? verifyCore : verify;
  const result = check(
    fs.readFileSync(canonicalPath, "utf-8"),
    fs.readFileSync(generatedPath, "utf-8")
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { verify, verifyCore, splitFrontmatter, parseFrontmatter, normalize, CRAFTED_MARKER, PRESET_MARKER };
