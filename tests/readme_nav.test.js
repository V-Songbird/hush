"use strict";

// The README navigation check that pre-commit and CI run. Every path is taken
// from the plugin root, so this file passes unchanged in each plugin that
// carries the same scripts/git-hooks/check-readme-nav.js.

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const CHECK = path.join(__dirname, "..", "scripts", "git-hooks", "check-readme-nav.js");
// The spawn limit this plugin's tests/helpers.js exports, or 30 s where it
// exports none, so the file stays the same in every plugin that carries it.
const SPAWN_TIMEOUT_MS = (() => {
  try {
    return require("./helpers").SPAWN_TIMEOUT_MS || 30000;
  } catch {
    return 30000;
  }
})();
const { slug, headingSlugs, anchorsIn, navRegion, checkMarkdown, main } = require(CHECK);

const NAV = [
  '<p align="center">',
  '  <a href="#install-it">Install it</a>',
  '  <a href="#the-numbers">The numbers</a>',
  '  <a href="#license">License</a>',
  "</p>",
  "",
  "## Install it",
  "## The numbers",
  "## License",
].join("\n");

describe("slug", () => {
  // github-slugger's own test cases, under the license in
  // scripts/git-hooks/vendor/github-slugger-LICENSE.
  test("matches all pinned github-slugger fixtures including duplicate collisions", () => {
    const cases = require("./fixtures/github-slugger-fixtures.json");
    const seen = new Set();
    for (const item of cases) {
      const base = slug(item.input);
      let actual = base;
      let suffix = 0;
      while (seen.has(actual)) actual = `${base}-${++suffix}`;
      seen.add(actual);
      assert.equal(actual, item.expected, item.name);
    }
  });

  test("preserves Unicode and the spaces surrounding removed punctuation", () => {
    assert.equal(slug("Instalación local posterior"), "instalación-local-posterior");
    assert.equal(slug("Archived entries — .notes/archive.jsonl"), "archived-entries--notesarchivejsonl");
    assert.equal(slug("日本語 中文"), "日本語-中文");
  });

  test("matches GitHub's rule", () => {
    assert.equal(slug("The fix"), "the-fix");
    assert.equal(slug('Why "this"'), "why-this");
    assert.equal(slug("Does it work?"), "does-it-work");
    assert.equal(slug("1. Make it write like a person"), "1-make-it-write-like-a-person");
  });
});

describe("headingSlugs", () => {
  test("assigns unique suffixes including collisions with explicitly numbered headings", () => {
    assert.deepEqual([...headingSlugs("# Section\n# Section\n# Section-1\n# Section\n")],
      ["section", "section-1", "section-1-1", "section-2"]);
  });

  test("handles tilde fences and shorter nested backtick sequences", () => {
    assert.deepEqual(
      [...headingSlugs("# Real\n~~~~\n# Hidden\n~~~\n# Still hidden\n~~~~\n````\n```\n# Hidden too\n````\n## Visible ###")],
      ["real", "visible"]);
  });

  test("uses the visible text of inline links", () => {
    assert.deepEqual([...headingSlugs("## [Install](https://example.org) `plugin`")], ["install-plugin"]);
  });

  test("collects every heading level", () => {
    assert.deepEqual([...headingSlugs("# One\n### Two words\n")].sort(), ["one", "two-words"]);
  });

  test("ignores headings inside a fenced block", () => {
    assert.deepEqual([...headingSlugs("# Real\n\n```\n## Quoted\n```\n")], ["real"]);
  });
});

describe("anchorsIn", () => {
  test("finds html and markdown in-page links", () => {
    assert.deepEqual(anchorsIn('<a href="#a">x</a> and [y](#b)'), ["a", "b"]);
  });

  test("ignores links that leave the page", () => {
    assert.deepEqual(anchorsIn('<a href="https://x/#frag">x</a> [y](other.md)'), []);
  });
});

describe("navRegion", () => {
  test("stops at the first section", () => {
    const region = navRegion("[a](#a)\n\n## First\n\n[b](#b)\n");
    assert.match(region, /#a/);
    assert.doesNotMatch(region, /#b/);
  });

  test("is the whole file when there are no sections", () => {
    assert.match(navRegion("[a](#a)\n"), /#a/);
  });
});

describe("checkMarkdown", () => {
  test("passes a page with an HTML href nav whose links all resolve", () => {
    assert.deepEqual(checkMarkdown(NAV, "README.md"), []);
  });

  test("resolves percent-encoded Unicode fragment links", () => {
    const text = NAV.replaceAll("Install it", "Instalación").replaceAll("install-it", "instalación")
      .replace('href="#instalación"', 'href="#instalaci%C3%B3n"');
    assert.deepEqual(checkMarkdown(text, "README.md"), []);
  });

  test("resolves a nav link to a duplicate heading's suffixed anchor", () => {
    const text = NAV.replace('<a href="#license">', '<a href="#license-1">') + "\n## License";
    assert.deepEqual(checkMarkdown(text, "README.md"), []);
  });

  test("flags a page with no nav", () => {
    const problems = checkMarkdown("## Install it\n", "README.md");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /no nav line/);
  });

  test("flags a nav that is too short to be one", () => {
    const problems = checkMarkdown("[a](#one)\n[b](#two)\n\n## One\n## Two\n", "README.md");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /no nav line/);
  });

  test("flags an anchor pointing at a renamed heading", () => {
    const problems = checkMarkdown(NAV.replace("## The numbers", "## Does it work?"), "README.md");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /#the-numbers/);
  });

  test("flags a dead anchor below the nav too", () => {
    const problems = checkMarkdown(NAV + "\n\nSee [that](#gone).\n", "README.md");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /#gone/);
  });

  test("does not resolve an anchor against a heading inside a fence", () => {
    const problems = checkMarkdown(NAV.replace("## License", "```\n## License\n```"), "README.md");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /#license/);
  });
});

describe("main", () => {
  test("staged validation reads the index even when the working README differs", () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "staged-nav-"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
    const git = (args) => cp.execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
    const file = path.join(root, "README.md");
    const run = () => {
      const result = cp.spawnSync(process.execPath, [CHECK, "staged"], { cwd: root, env, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS });
      if (result.error && result.error.code === "ETIMEDOUT") throw new Error(`check-readme-nav.js timed out after ${SPAWN_TIMEOUT_MS} ms`);
      return result;
    };
    try {
      git(["init", "-q"]);
      fs.writeFileSync(file, NAV.replace("## License", "## Different heading"));
      git(["add", "README.md"]);
      fs.writeFileSync(file, NAV);
      const bad = run();
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /README.md \(staged\)/);
      git(["add", "README.md"]);
      fs.writeFileSync(file, "## Broken working copy");
      assert.equal(run().status, 0);
      fs.unlinkSync(file);
      git(["add", "README.md"]);
      assert.equal(run().status, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("reads its targets from the argv it is given, not process.argv", () => {
    // Point process.argv at a real file with no nav, which would fail, and
    // pass a missing file, which is skipped: a 0 proves the parameter won.
    const saved = process.argv.slice();
    process.argv = [saved[0], saved[1], __filename];
    try {
      assert.equal(main(["no-such-file-here.md"]), 0);
    } finally {
      process.argv = saved;
    }
  });
});
