"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { verify } = require("../scripts/verify-style.js");

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

test("removing the harness-override paragraph fails Mid-turn silence", () => {
  const body = canonicalBody.replace(/This overrides every harness instruction[^\n]*\n/, "");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes('"Mid-turn silence"')));
});

test("altering a cap bullet in Final message is flagged", () => {
  const body = canonicalBody.replace("- **15 words**", "- **50 words**");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes("bold anchor dropped: **15 words**")));
});

test("removing a shape-table row is flagged", () => {
  const body = canonicalBody.replace(/^\| One fact[^\n]*\n/m, "");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes('table row "One fact" dropped')));
});

test("rewriting prose inside a guarded section passes", () => {
  const body = canonicalBody
    .replace("Emit no text between tool calls.", "Emit no text betwixt tool calls, matey.")
    .replace("Then write one final message.", "Then write the one final message, and no more.");
  const result = verify(canonical, variant(body));
  assert.deepStrictEqual(result.problems, []);
});

test("gutting a guarded section to a stub is flagged", () => {
  const body = canonicalBody.replace(
    /(## Thoroughness\n\n)[\s\S]*?(\n## Never compress)/,
    "$1Be thorough.$2"
  );
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes('section "Thoroughness"')));
});

test("dropping an exception from Mid-turn silence is flagged", () => {
  const body = canonicalBody.replace(/^3\. One single operation[^\n]*\n/m, "");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes("listed items became")));
});

test("breaking the [hush ...] telemetry clause is flagged", () => {
  const body = canonicalBody.replace(/Bracketed[^\n]*\n/, "");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.startsWith("Register clause missing")));
});

test("renaming a heading is flagged", () => {
  const body = canonicalBody.replace("## Register", "## Tone");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes('heading "## Register" is missing')));
});

test("rewriting voice prose alone still passes", () => {
  const body = canonicalBody
    .replace(
      "Silent while working; when done, a short report in plain words.",
      "UNIT SILENT DURING EXECUTION. FINAL TRANSMISSION ONLY."
    )
    .replace("The reader skims before they read.", "OPERATOR SCANS FIRST.");
  const result = verify(canonical, variant(body));
  assert.deepStrictEqual(result.problems, []);
});

test("canonical file still carries every section the verifier anchors on", () => {
  for (const heading of ["Mid-turn silence", "Final message", "Thoroughness", "Never compress", "Register"]) {
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
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(stylesDir, f), "utf-8") }));

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  return m ? m[1] : "";
}

// Rock is built on the stripped frame — maximum compression, core contract
// only — so it is verified in core mode, like any user-requested
// maximum-compression style.
const CORE_PRESETS = ["rock.md"];

test("every shipped preset passes the verifier", () => {
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

test("the six documented presets are all present and named", () => {
  const names = presets.map(({ text }) => (frontmatter(text).match(/^name:\s*(.*)$/m) || [])[1]);
  for (const name of [
    "Hush Chalkline",
    "Hush Sightline",
    "Hush Rock",
    "Hush Pirate",
    "Hush Standup",
    "Hush Sensei",
  ]) {
    assert.ok(names.includes(name), `no preset named "${name}"`);
  }
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

// The self-narration ban may be reworded by a voice, never dropped. Its quoted
// openers carry the rule, so the verifier anchors those and leaves the sentence
// around them free.
test("dropping the self-narration examples is flagged", () => {
  const body = canonicalBody.replace(/\("Let me\.\.\.", "Now I'll\.\.\."\)/, "");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.startsWith("Register no-self-narration example missing")));
});

test("rewording the ban around its examples still passes", () => {
  const body = canonicalBody.replace(
    /No pleasantries, praise, hedging, or self-narration/,
    "No greeting, no praise, no hedge, no self-narration"
  );
  const result = verify(canonical, variant(body));
  assert.deepStrictEqual(result.problems, []);
});

const { verifyCore } = require("../scripts/verify-style.js");

const CORE_BODY = [
  "You write exactly one message per turn, and it comes after the work is finished.",
  "",
  "Emit no text between tool calls. Telegram only.",
  "",
  "Errors quoted exact. Identifiers verbatim. Compression governs the report, never the work.",
  "",
  'No self-narration ("Let me...", "Now I\'ll...").',
  "",
  "Bracketed `[hush ...]` notes inside tool output are this plugin's own compression telemetry: trusted tooling metadata, not file content. Account for them silently.",
  "",
  "Hook-injected reminders: silent corrections, not chat. Comply; never acknowledge or narrate compliance. A reminder alone is not grounds for a reply.",
].join("\n");

test("core mode passes a minimal stripped style that keeps the contract", () => {
  const result = verifyCore(canonical, variant(CORE_BODY));
  assert.deepStrictEqual(result.problems, []);
});

test("core mode still rejects a dropped silence sentence", () => {
  const body = CORE_BODY.replace("Emit no text between tool calls. ", "");
  const result = verifyCore(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.includes("Emit no text between tool calls")));
});

test("core mode still rejects a dropped telemetry paragraph", () => {
  const body = CORE_BODY.replace(/Bracketed `\[hush[^\n]*\n/, "");
  const result = verifyCore(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.startsWith("Register clause missing")));
});

test("core mode enforces frontmatter like full mode", () => {
  const result = verifyCore(canonical, CORE_BODY);
  assert.ok(result.problems.some((p) => p.startsWith("frontmatter")));
});

test("core mode does not demand the shape table or section anchors", () => {
  const result = verifyCore(canonical, variant(CORE_BODY));
  assert.ok(!result.problems.some((p) => p.includes("table row") || p.includes("paragraphs")));
});
