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
  assert.ok(result.problems.some((p) => p.startsWith("Final message line missing")));
});

test("removing a shape-table row is flagged", () => {
  const body = canonicalBody.replace(/^\| One fact[^\n]*\n/m, "");
  const result = verify(canonical, variant(body));
  assert.ok(result.problems.some((p) => p.startsWith("Final message line missing")));
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

test("every shipped preset passes the verifier", () => {
  assert.ok(presets.length > 0, "styles/ holds no presets");
  for (const { file, text } of presets) {
    const result = verify(canonical, text);
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

test("the four documented presets are all present and named", () => {
  const names = presets.map(({ text }) => (frontmatter(text).match(/^name:\s*(.*)$/m) || [])[1]);
  for (const name of ["Hush Chalkline", "Hush Sightline", "Hush Rock", "Hush Pirate"]) {
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
