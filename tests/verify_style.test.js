"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { verify, verifyCore, sections, CRAFTED_MARKER, GUARDED_SECTIONS } = require("../scripts/verify-style.js");

const pluginRoot = path.join(__dirname, "..");
const canonicalPath = path.join(pluginRoot, "output-styles", "hush.md");
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
  for (const heading of GUARDED_SECTIONS) {
    assert.ok(canonical.includes("## " + heading), 'hush.md lost "## ' + heading + '"');
  }
});

// The gap that shipped the 1.9.0 "## Shape" rules unguarded: a section added to
// stock and left out of GUARDED_SECTIONS has its heading required and its rules
// unchecked, so a crafted style could gut it and still pass.
test("every section of stock is guarded, not merely named", () => {
  assert.deepStrictEqual(Object.keys(sections(canonicalBody)), GUARDED_SECTIONS);
});

function gut(body, name) {
  return body.replace(
    new RegExp("## " + name + "\\n[\\s\\S]*?(?=\\n## |$)"),
    "## " + name + "\n\nKeep it tidy.\n"
  );
}

test("gutting a guarded section's rules is flagged", () => {
  for (const name of GUARDED_SECTIONS) {
    const result = verify(canonical, variant(gut(canonicalBody, name)));
    assert.ok(
      result.problems.some((problem) => problem.includes('section "' + name + '"')),
      name + " can be gutted without the verifier noticing"
    );
  }
});

// --- what craft-style produces ---------------------------------------------
//
// The skill's promise is that a style can be rewritten into any voice and still
// keep hush's mechanics. This stands in for its output: stock's rules with the
// words changed, the substitution held out of code spans, and the passages that
// must survive byte for byte left alone. It is derived from stock at run time,
// so it cannot fall behind the way the shipped presets did.
function inVoice(body) {
  return body
    .split("\n")
    .map((line) =>
      line.startsWith("## ")
        ? line
        : line
            .split(/(`[^`\n]*`)/)
            .map((part, i) => (i % 2 ? part : part.replace(/\byou\b/g, "ye").replace(/\byour\b/g, "yer")))
            .join("")
    )
    .join("\n");
}

test("the voice rewrite this suite checks really is a rewrite", () => {
  const voiced = inVoice(canonicalBody);
  assert.notStrictEqual(voiced, canonicalBody);
  const opening = canonicalBody.split("\n").map((line) => line.trim()).find(Boolean);
  assert.ok(voiced.includes(opening), "the opening rule was reworded");
  for (const para of canonicalBody.split(/\n{2,}/)) {
    if (para.includes("[hush") || /hook reminder/i.test(para))
      assert.ok(voiced.includes(para.trim()), "a verbatim passage was reworded");
  }
});

test("a style rewritten into another voice passes every check", () => {
  const result = verify(canonical, variant(inVoice(canonicalBody)));
  assert.deepStrictEqual(result.problems, []);
});

test("the same rewrite, gutted section by section, always fails", () => {
  const voiced = inVoice(canonicalBody);
  for (const name of GUARDED_SECTIONS) {
    assert.strictEqual(verify(canonical, variant(gut(voiced, name))).ok, false, name + " survived being gutted");
  }
});

// --- the skills and the verifier agree -------------------------------------

const skillsDir = path.join(pluginRoot, "skills");
const skill = (name) => fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf-8");

test("craft-style tells the author the exact marker the verifier demands", () => {
  assert.ok(skill("craft-style").includes(CRAFTED_MARKER));
});

test("craft-style names every section the verifier guards", () => {
  const named = GUARDED_SECTIONS.filter((name) => skill("craft-style").includes("`" + name + "`"));
  assert.deepStrictEqual(named, GUARDED_SECTIONS, "craft-style promises a different set of guarded sections");
});

// hush shipped four preset voices until 1.10.0. They were unmeasured and they
// fell behind the stock voice at every release, so they were cut.
test("the plugin ships stock and nothing else", () => {
  assert.strictEqual(fs.existsSync(path.join(pluginRoot, "styles")), false, "styles/ is back");
  for (const name of ["craft-style", "pick-style"]) {
    assert.ok(!/preset/i.test(skill(name)), name + " still describes a shipped preset");
  }
  assert.ok(!/preset/i.test(fs.readFileSync(path.join(pluginRoot, "README.md"), "utf-8")));
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
