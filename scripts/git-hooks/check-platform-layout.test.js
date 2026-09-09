"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { platformName, violations, trackedPaths, parseArgs } = require("./check-platform-layout.js");
const cli = path.join(__dirname, "check-platform-layout.js");

test("Codex rejects Claude configuration at any depth and in either path notation", () => {
  const bad = [".claude/settings.json", ".CLAUDE-plugin/plugin.json", "nested/CLAUDE.md", "nested\\Claude.local.md"];
  assert.deepEqual(violations(bad, "Codex"), bad.sort());
});
test("Claude rejects Codex and shared agent entry paths regardless of case", () => {
  const bad = [".agents/skills/a/SKILL.md", ".codex/config.toml", ".Codex-plugin/plugin.json", "nested/AGENTS.md", "AGENTS.override.md", "CODEX.md"];
  assert.deepEqual(violations(bad, "Claude"), bad.sort());
});
test("each platform keeps its own configuration and neutral code", () => {
  assert.deepEqual(violations([".codex-plugin/plugin.json", "AGENTS.md", "scripts/claude-migration.js", "docs/claude-history.md", "tests/host.test.js"], "Codex"), []);
  assert.deepEqual(violations([".claude-plugin/plugin.json", "CLAUDE.md", "scripts/codex-migration.js", "docs/codex-history.md", "skills/a/SKILL.md"], "Claude"), []);
});
test("near-miss names are allowed and duplicate violations are reported once", () => {
  assert.deepEqual(violations(["agents.md.example", ".codex-backup/a", "docs/agents.md.txt"], "Claude"), []);
  assert.deepEqual(violations(["CLAUDE.md", "CLAUDE.md"], "Codex"), ["CLAUDE.md"]);
});
test("benchmark trees belong to Foundry while nested test fixtures remain allowed", () => {
  const files = ['benchmarks/runner/run.js', '.benchmarks/config.json', 'tests/fixtures/benchmarks/example.json'];
  for (const platform of ['Claude', 'Codex']) assert.deepEqual(violations(files, platform), ['.benchmarks/config.json', 'benchmarks/runner/run.js']);
});
test("unknown branches and malformed CLI options fail explicitly", () => {
  assert.equal(platformName("cOdEx"), "Codex");
  assert.throws(() => platformName("main"), /Unknown platform/);
  assert.throws(() => parseArgs(["--ref"]), /Missing value/);
  assert.throws(() => parseArgs(["--ref", "HEAD", "--staged"]), /Choose/);
  assert.throws(() => parseArgs(["--anything"]), /Unknown argument/);
});

function fixture(fn) {
  const repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "platform-layout-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && !key.startsWith("GITHUB_")));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8", stdio: "pipe" });
  const write = (name, text = "fixture\n") => { const target = path.join(repo, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  const run = (args = [], extraEnv = {}) => spawnSync(process.execPath, [cli, "--repo", repo, ...args], {env: {...env, ...extraEnv}, encoding: "utf8"});
  try {
    git("init", "-b", "Codex");
    git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
    write("README.md");git("add", "README.md");git("-c", "core.hooksPath=", "commit", "-m", "fixture");
    fn({ repo, git, write, run });
  } finally {
    const resolved = path.resolve(repo), tempRoot = fs.realpathSync(os.tmpdir());
    if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith("platform-layout-")) throw new Error("Unsafe fixture cleanup path");
    fs.rmSync(resolved, {recursive: true, force: true});
  }
}

test("committed trees catch old foreign files even when the working copy deletes them", () => fixture(({repo, git, write, run}) => {
  write(".claude-plugin/plugin.json", "{}\n");git("add", ".claude-plugin/plugin.json");git("-c", "core.hooksPath=", "commit", "-m", "foreign fixture");
  fs.unlinkSync(path.join(repo,".claude-plugin/plugin.json"));
  assert.equal(run().status, 0);
  assert.equal(run(["--staged"]).status, 1);
  const committed = run(["--ref", "HEAD"]);
  assert.equal(committed.status, 1);assert.match(committed.stderr,/\.claude-plugin\/plugin.json/);
  git("add", "-u");assert.equal(run(["--staged"]).status,0);
}));
test("working-tree checks include new files while staged checks inspect only the index", () => fixture(({write,run}) => {
  write("nested/CLAUDE.md");
  assert.equal(run().status,1);
  assert.equal(run(["--staged"]).status,0);
}));
test("ignored local state is not treated as a file that will be pushed", () => fixture(({write,run}) => {
  write(".gitignore", ".claude/\n");write(".claude/settings.local.json", "{}\n");
  assert.equal(run().status,0);
}));
test("PR destination overrides the source branch and detached merge-ref names", () => fixture(({write,run}) => {
  write("AGENTS.md");
  const pr=run([], {GITHUB_BASE_REF:"Claude", GITHUB_REF_NAME:"123/merge"});
  assert.equal(pr.status,1);assert.match(pr.stderr,/Claude platform layout failed/);
  assert.equal(run(["--platform","Codex"],{GITHUB_BASE_REF:"Claude"}).status,0);
}));
test("bad refs and unresolved platforms fail closed", () => fixture(({run}) => {
  assert.equal(run(["--ref","missing-ref"]).status,2);
  assert.equal(run([],{GITHUB_REF_NAME:"main"}).status,2);
}));
test("Foundry's dual catalogs are refused rather than applying a plugin policy to the parent", () => fixture(({write,run}) => {
  write(".claude-plugin/marketplace.json", "{}\n");write(".agents/plugins/marketplace.json", "{}\n");
  const result=run();assert.equal(result.status,2);assert.match(result.stderr,/shared Foundry marketplace/);
}));
test("explicit repositories are isolated from inherited Git environment variables", () => fixture(({repo,write}) => {
  write("CLAUDE.md");
  const saved=process.env.GIT_DIR;
  process.env.GIT_DIR=path.join(repo,"missing-git-dir");
  try { assert.ok(trackedPaths(repo).includes("CLAUDE.md")); }
  finally { if(saved===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=saved; }
}));

test("Foundry's checked-out plugin copies match the canonical checker and workflow", t => {
  const root = path.resolve(__dirname, "..", "..");
  if (!fs.existsSync(path.join(root, ".gitmodules"))) return t.skip("Standalone plugin checkout");
  const canonical = fs.readFileSync(cli, "utf8");
  const template = fs.readFileSync(path.join(root, ".github", "PLUGIN_PLATFORM_LAYOUT_WORKFLOW.yml"), "utf8");
  for (const plugin of ["foreman", "hush", "razor"]) {
    const copy = path.join(root, plugin, "scripts", "git-hooks", "check-platform-layout.js");
    if (!fs.existsSync(copy)) continue;
    assert.equal(fs.readFileSync(copy, "utf8"), canonical, `${plugin}: checker drift`);
    assert.equal(fs.readFileSync(path.join(root, plugin, ".github", "workflows", "platform-layout.yml"), "utf8"), template, `${plugin}: workflow drift`);
  }
});
