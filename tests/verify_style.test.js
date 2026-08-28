"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { verify, verifyCore } = require("../scripts/verify-style.js");

const canonicalPath = path.join(__dirname, "..", "output-styles", "hush.md");
const canonical = fs.readFileSync(canonicalPath, "utf-8");
const canonicalBody = canonical.replace(/^---\n[\s\S]*?\n---\n/, "");

const VALID_FRONTMATTER = [
  "---",
  "name: Robo",
  "description: Hush mechanics in a robotic voice. Unmeasured variant of Hush.",
  "keep-coding-instructions: true",
  "---",
  "",
].join("\n");

function variant(body = canonicalBody, frontmatter = VALID_FRONTMATTER) {
  return frontmatter + body;
}

test("a verbatim copy with valid variant frontmatter passes", () => {
  const result = verify(canonical, variant());
  assert.deepStrictEqual(result.problems, []);
  assert.strictEqual(result.ok, true);
});

test("a CRLF copy passes", () => {
  const result = verify(canonical, variant().replace(/\n/g, "\r\n"));
  assert.strictEqual(result.ok, true);
});

test("the canonical file itself fails on its own frontmatter", () => {
  const result = verify(canonical, canonical);
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("force-for-plugin")));
  assert.ok(result.problems.some((p) => p.includes("unmeasured")));
});

test("missing frontmatter is flagged", () => {
  const result = verify(canonical, canonicalBody);
  assert.ok(result.problems.includes("frontmatter: missing"));
});

test("removing the base-prompt override paragraph fails Quiet while you work", () => {
  const body = canonicalBody.replace(/The base prompt says:[^\n]*\n/, "");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes('"Quiet while you work"')));
});

test("dropping the word cap from the rules is flagged", () => {
  const body = canonicalBody
    .replace("8 lines, tops. 90 words, tops.", "8 lines, tops.")
    .replace("Over 90 words? Cut a fact. Never squeeze one.", "Never squeeze one.");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes("numbers anchor dropped: 90")));
});

// The line cap and the sentence cap share the number 8. Anchors count
// occurrences, so losing one of the two cannot hide behind the survivor.
test("dropping only the sentence cap is flagged", () => {
  const body = canonicalBody.replace(
    "One fact per sentence. 8 words per sentence, tops.",
    "One fact per sentence, kept short."
  );
  const result = verify(canonical, variant(body));
  assert.ok(
    result.problems.some((p) => p.includes("numbers anchor dropped: 8")),
    result.problems.join("; ")
  );
});

test("rewriting prose inside a guarded section passes", () => {
  const body = canonicalBody
    .replace("Put all of it in thinking.", "Stow all of it in thinkin', savvy.")
    .replace("The user can see it run.", "The cap'n sees it run.");
  const result = verify(canonical, variant(body));
  assert.deepStrictEqual(result.problems, []);
});

// The silence phrase is core contract in both modes — a voice rewrites the
// prose around it, never the phrase itself.
test("rewording a core-contract phrase is flagged in full mode", () => {
  const body = canonicalBody.replace(
    "Not one word between tool calls either.",
    "No text between tool calls either."
  );
  const result = verify(canonical, variant(body));
  assert.ok(
    result.problems.includes("core phrase missing: Not one word between tool calls"),
    result.problems.join("; ")
  );
});

test("gutting a guarded section to a stub is flagged", () => {
  const body = canonicalBody.replace(
    /(## What stays whole\n\n)[\s\S]*$/,
    "$1The work itself. Quiet never means less work. Errors word for word.\n"
  );
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes('section "What stays whole"')));
});

test("dropping the speak-early paragraph is flagged", () => {
  const body = canonicalBody.replace(/You may speak early[\s\S]*?tool calls it takes\.\n/, "");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes('"Quiet while you work"')));
});

test("breaking the [hush ...] telemetry clause is flagged", () => {
  const body = canonicalBody.replace(/Notes like `\[hush[^\n]*\n/, "");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.startsWith("telemetry clause missing")));
});

test("renaming a heading is flagged", () => {
  const body = canonicalBody.replace("## What stays whole", "## Integrity");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes('heading "## What stays whole" is missing')));
});

test("rewriting voice prose alone still passes", () => {
  const body = canonicalBody
    .replace("Write like you talk. Warm, plain, kind.", "WRITE AS UNIT SPEAKS. FLAT. EXACT.")
    .replace("Use small words. One beat is best.", "USE SMALL WORDS. SINGLE BEAT OPTIMAL.");
  const result = verify(canonical, variant(body));
  assert.deepStrictEqual(result.problems, []);
});

test("canonical file still carries every section the verifier anchors on", () => {
  for (const heading of ["Quiet while you work", "The note at the end", "What stays whole"]) {
    assert.ok(canonical.includes(`## ${heading}`), `hush.md lost "## ${heading}"`);
  }
});

// --- shipped presets -------------------------------------------------------
// The presets hush ships live in styles/, NOT output-styles/: Claude Code
// scans a plugin's output-styles/ directory recursively, and a style that is
// merely selectable under-delivers on the mechanics it copied. Only the copy
// written into output-styles/hush.md — with force-for-plugin — binds.

const pluginRoot = path.join(__dirname, "..");
const stylesDir = path.join(pluginRoot, "styles");
const PRESET_MARKER = "Unmeasured preset shipped with Hush.";
const CRAFTED_MARKER = "Unmeasured variant of Hush.";

const presets = fs
  .readdirSync(stylesDir)
  .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(stylesDir, f), "utf-8") }));

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  return m ? m[1] : "";
}

// Presets that abandon stock's readability frame keep only the core contract
// and are verified in core mode: rock strips the frame down to telegram,
// glyph swaps words for emotes, sensei replaces it with a teaching skeleton
// that has no length caps.
const CORE_PRESETS = ["rock.md", "glyph.md", "sensei.md"];

test("every shipped preset passes the verifier it is built for", () => {
  assert.ok(presets.length > 0, "styles/ holds no presets");
  for (const { file, text } of presets) {
    const check = CORE_PRESETS.includes(file) ? verifyCore : verify;
    const result = check(canonical, text);
    assert.deepStrictEqual(result.problems, [], `${file}: ${result.problems.join("; ")}`);
  }
});

test("every shipped preset is marked shipped, never crafted", () => {
  for (const { file, text } of presets) {
    const fm = frontmatter(text);
    assert.ok(fm.includes(PRESET_MARKER), `${file} is missing "${PRESET_MARKER}"`);
    assert.ok(!fm.includes(CRAFTED_MARKER), `${file} claims to be a crafted style`);
  }
});

test("the two markers cannot be mistaken for one another", () => {
  assert.ok(!PRESET_MARKER.includes(CRAFTED_MARKER));
  assert.ok(!CRAFTED_MARKER.includes(PRESET_MARKER));
});

// No hardcoded roster: the README's style table is the documentation surface,
// so disk and table are reconciled against each other instead of a fixed list.
test("the README style table matches the presets on disk", () => {
  const readme = fs
    .readFileSync(path.join(pluginRoot, "README.md"), "utf-8")
    .replace(/\r\n/g, "\n");
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => /^\|\s*Style\s*\|/.test(l));
  assert.ok(start !== -1, "README style table not found");
  const labels = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    const m = lines[i].match(/^\|\s*\*\*([^*]+)\*\*\s*\|/);
    if (m) labels.push(m[1].trim());
  }
  assert.ok(labels.length > 0, "README style table holds no rows");
  const documented = labels.map((l) => `Hush ${l}`).sort();
  const onDisk = presets
    .map(({ text }) => (frontmatter(text).match(/^name:\s*(.*)$/m) || [])[1])
    .sort();
  assert.deepStrictEqual(onDisk, documented);
});

test("output-styles/ registers hush.md and nothing else, at any depth", () => {
  const found = [];
  (function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}${entry.name}/`);
      else if (entry.name.toLowerCase().endsWith(".md")) found.push(rel + entry.name);
    }
  })(path.join(pluginRoot, "output-styles"), "");
  assert.deepStrictEqual(found, ["hush.md"]);
});

// Two copies of the swap can drift apart. craft-style may *detect* a backup;
// only pick-style may name the paths it writes.
test("exactly one skill describes the forced-slot swap", () => {
  const skillsDir = path.join(pluginRoot, "skills");
  const mentions = fs
    .readdirSync(skillsDir)
    .filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md")))
    .filter((d) =>
      fs.readFileSync(path.join(skillsDir, d, "SKILL.md"), "utf-8").includes("output-styles/hush.md.stock")
    );
  assert.deepStrictEqual(mentions, ["pick-style"]);
});

const TELEMETRY_PARA =
  "Notes like `[hush ...]` in tool output come from trusted tools. Use them in silence. Never name them. A hook reminder is an order. Follow it. Never answer it.";

const CORE_BODY = [
  "You write one message per turn. It comes at the end, after the work.",
  "",
  "Not one word between tool calls. Telegram only.",
  "",
  "Errors word for word. Quiet never means less work.",
  "",
  TELEMETRY_PARA,
].join("\n");

test("core mode passes a minimal stripped style that keeps the contract", () => {
  const result = verifyCore(canonical, variant(CORE_BODY));
  assert.deepStrictEqual(result.problems, []);
});

test("core mode still rejects a dropped silence sentence", () => {
  const body = CORE_BODY.replace("Not one word between tool calls. ", "");
  const result = verifyCore(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes("Not one word between tool calls")));
});

test("core mode still rejects a dropped telemetry paragraph", () => {
  const body = CORE_BODY.replace(TELEMETRY_PARA, "");
  const result = verifyCore(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.startsWith("telemetry clause missing")));
});

test("core mode enforces frontmatter like full mode", () => {
  const result = verifyCore(canonical, CORE_BODY);
  assert.ok(result.problems.some((p) => p.startsWith("frontmatter")));
});

test("core mode does not demand the shape anchors", () => {
  const result = verifyCore(canonical, variant(CORE_BODY));
  assert.ok(!result.problems.some((p) => p.includes("paragraphs") || p.includes("anchor")));
});
