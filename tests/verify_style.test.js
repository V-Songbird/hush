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
