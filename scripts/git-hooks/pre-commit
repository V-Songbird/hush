#!/usr/bin/env node
"use strict";

// Canonical source for the pre-commit hook installed at
// scripts/git-hooks/pre-commit in every plugin's own repo (forge, verity,
// foreman, hush, razor, jetbrains-router). Keep copies in sync with this
// file -- see CONTRIBUTING.md "Git hooks" in each plugin repo.
//
// Blocks a commit if `node --test tests/*.test.js` fails. No-ops when the
// plugin has no tests/ directory (skill/prompt-only plugins with no
// scripted behavior aren't required to have one -- see each plugin's
// CONTRIBUTING.md "Tests" section).

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function repoRoot() {
  return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
}

function testGlob(root) {
  return path.join(root, "tests", "*.test.js");
}

// Strip env vars before spawning the nested `node --test`:
//
// - NODE_TEST_CONTEXT / NODE_CHANNEL_FD: node's own test-runner IPC markers.
//   Inheriting these (set when this hook's own test runs as an isolated
//   child under `node --test`) makes the nested process misbehave and exit
//   silently instead of reporting real results.
//
// - GIT_* (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, etc.): git sets these
//   when invoking a hook so the hook can find the repo without `cd`-ing
//   there. If a plugin's own tests shell out to `git` against a temp
//   fixture (a `cwd` override), these inherited vars win over `cwd` for
//   repo discovery -- so "isolated" git commands in the test suite land in
//   THIS repo's real .git instead of the fixture, corrupting it. Confirmed
//   empirically 2026-07-07: foreman's test helper's `initGitRepo()` (cwd
//   set to a tmpdir) still wrote its config into the real submodule gitdir
//   when this hook ran through an actual `git commit`.
function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_CHANNEL_FD;
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

function main() {
  const root = repoRoot();
  if (!fs.existsSync(path.join(root, "tests"))) return 0;

  try {
    execSync(`node --test "${testGlob(root)}"`, { stdio: "inherit", cwd: root, env: cleanEnv() });
    return 0;
  } catch {
    process.stderr.write(
      "\n[pre-commit] `node --test tests/*.test.js` failed -- fix the failure before committing " +
        "(or `git commit --no-verify` to override deliberately).\n\n"
    );
    return 1;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, repoRoot, testGlob, cleanEnv };
