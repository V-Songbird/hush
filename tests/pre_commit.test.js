"use strict";

// The pre-commit hook prints only the suite's summary, and after it the
// failing tests when one fails, instead of the whole spec output. It runs
// here against a fixture repository with its own tests/, so the result does
// not depend on this plugin's suite. Every path is taken from the plugin
// root, so this file passes unchanged in each plugin that carries the same
// scripts/git-hooks/pre-commit.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

// The spawn limit this plugin's tests/helpers.js exports, or 30 s where it
// exports none, so the file stays the same in every plugin that carries it.
const SPAWN_TIMEOUT_MS = (() => {
  try {
    return require("./helpers").SPAWN_TIMEOUT_MS || 30000;
  } catch {
    return 30000;
  }
})();
const PRE_COMMIT = path.join(__dirname, "..", "scripts", "git-hooks", "pre-commit");

test("prints the summary, and the failing tests only when one fails", () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pre-commit-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const tests = path.join(root, "tests");
  const run = () => {
    const result = cp.spawnSync(process.execPath, [PRE_COMMIT], { cwd: root, env, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS });
    if (result.error && result.error.code === "ETIMEDOUT") throw new Error(`pre-commit timed out after ${SPAWN_TIMEOUT_MS} ms`);
    if (result.error) throw result.error;
    return { ...result, stdout: result.stdout.replace(/\x1b\[[\d;]*m/g, "") };
  };
  try {
    cp.execFileSync("git", ["init", "-q"], { cwd: root, env, stdio: "pipe" });
    fs.mkdirSync(tests);
    fs.writeFileSync(path.join(tests, "pass.test.js"), 'require("node:test")("fixture passes", () => {});\n');
    fs.writeFileSync(
      path.join(tests, "fail.test.js"),
      'require("node:test")("fixture fails", () => { throw new Error("fixture failure"); });\n'
    );

    const bad = run();
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /^ℹ tests 2\n/);
    assert.match(bad.stdout, /failing tests:[\s\S]*fixture fails[\s\S]*fixture failure/);
    assert.doesNotMatch(bad.stdout, /fixture passes/);
    assert.match(bad.stderr, /\[pre-commit\] `node --test tests\/\*\.test\.js` failed/);

    fs.unlinkSync(path.join(tests, "fail.test.js"));
    const good = run();
    assert.equal(good.status, 0);
    assert.match(good.stdout, /^ℹ tests 1\n[\s\S]*ℹ pass 1\n[\s\S]*ℹ fail 0\n/);
    assert.deepEqual(good.stdout.split("\n").filter((line) => line && !line.startsWith("ℹ ")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
