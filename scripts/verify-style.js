#!/usr/bin/env node
"use strict";

// Mechanical check that a crafted output style kept hush's mechanics.
// Advisory like verify-compression.js: reports what didn't survive and
// exits 1 — it never edits anything. The canonical file is the source of
// truth for every invariant, so this script carries no copied prose.

const VERBATIM_SECTIONS = ["Mid-turn silence", "Thoroughness", "Never compress"];

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

function verify(canonicalText, generatedText) {
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
    if (!/unmeasured/i.test(fm.description || ""))
      problems.push('frontmatter: description must say "unmeasured"');
  }

  const canSections = sections(canonical.body);
  const genLines = new Set(generated.body.split("\n"));

  // Everything above the first heading is preamble. Its first line is the
  // one-message-per-turn rule and is a mechanic; the lines after it are the
  // opening voice and stay rewritable.
  const openingRule = (canonical.body.split(/^## /m)[0] || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (openingRule && !generated.body.includes(openingRule))
    problems.push(`opening rule missing: ${openingRule.slice(0, 60)}`);

  for (const name of VERBATIM_SECTIONS) {
    const body = canSections[name];
    if (!body) {
      problems.push(`canonical: section "${name}" not found`);
    } else if (!generated.body.includes(body)) {
      problems.push(`section "${name}" is not present verbatim`);
    }
  }

  for (const name of Object.keys(canSections)) {
    if (!generated.body.includes(`## ${name}`))
      problems.push(`heading "## ${name}" is missing`);
  }

  for (const line of (canSections["Final message"] || "").split("\n")) {
    if ((/^\|/.test(line) || /^- \*\*/.test(line)) && !genLines.has(line))
      problems.push(`Final message line missing: ${line.slice(0, 60)}`);
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

function main() {
  const [canonicalPath, generatedPath] = process.argv.slice(2);
  if (!canonicalPath || !generatedPath) {
    console.error("Usage: verify-style.js <canonical-hush.md> <generated-style.md>");
    process.exit(1);
  }
  const fs = require("fs");
  const result = verify(
    fs.readFileSync(canonicalPath, "utf-8"),
    fs.readFileSync(generatedPath, "utf-8")
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { verify };
