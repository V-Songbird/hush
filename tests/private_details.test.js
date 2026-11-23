"use strict";

const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SCRIPT = path.join(__dirname, "..", "scripts", "git-hooks", "check-private-details.js");
const SECRET = "Quartz-Lantern-7741";

function fixture(t, { file = "notes.txt", content = "clean\n", message = "change" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "private-details-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
  git("init", "--quiet");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(dir, file), content);
  git("add", ".");
  git("commit", "--quiet", "-m", message);
  return { dir, base, head: git("rev-parse", "HEAD") };
}

function run({ dir, base, head }, env = {}) {
  const clean = { ...process.env };
  for (const key of ["PRIVATE_DETAILS", "PR_TITLE", "PR_BODY", "GITHUB_STEP_SUMMARY"]) delete clean[key];
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: { ...clean, BASE_SHA: base, HEAD_SHA: head, PRIVATE_DETAILS: `first-unused\r\n\r\n${SECRET}\r\n`, ...env },
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

const cases = [
  ["an added line", { content: `x ${SECRET.toLowerCase()} y\n` }, {}],
  ["an added path", { file: `${SECRET}.txt` }, {}],
  ["a commit message", { message: `fix ${SECRET}` }, {}],
  ["the title", {}, { PR_TITLE: SECRET }],
  ["the body", {}, { PR_BODY: `see ${SECRET}` }],
];

for (const [kind, change, env] of cases) {
  test(`a match in ${kind} fails with the entry number and never the value`, (t) => {
    const { status, output } = run(fixture(t, change), env);
    assert.equal(status, 1);
    assert.match(output, new RegExp(`Entry 3 of the private list matched in ${kind}`));
    assert.doesNotMatch(output, new RegExp(SECRET, "i"));
  });
}

test("a removed line does not match", (t) => {
  const repo = fixture(t, { file: "base.txt", content: "changed\n" });
  assert.equal(run(repo, { PRIVATE_DETAILS: "base" }).status, 0);
});

test("a clean pull request passes", (t) => {
  const { status, output } = run(fixture(t));
  assert.equal(status, 0);
  assert.match(output, /No private detail found/);
});

test("a run with no list is reported as unchecked, never as passed", (t) => {
  for (const list of ["", " \r\n "]) {
    const { status, output } = run(fixture(t), { PRIVATE_DETAILS: list });
    assert.equal(status, 0);
    assert.match(output, /::warning .*UNCHECKED/);
    assert.doesNotMatch(output, /No private detail found/);
  }
});

test("a pull request it cannot read fails without scanning", (t) => {
  const { status, output } = run(fixture(t), { BASE_SHA: "0".repeat(40) });
  assert.equal(status, 2);
  assert.doesNotMatch(output, new RegExp(SECRET, "i"));
});
