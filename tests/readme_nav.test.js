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
const PRE_COMMIT = path.join(__dirname, "..", "scripts", "git-hooks", "pre-commit");
const { slug, headingSlugs, anchorsIn, linkedAnchorsIn, navRegion, checkMarkdown, main } = require(CHECK);

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

// A docs page and the README that links into it. The page needs no nav, but
// its own anchor, its link back to the README and the README's link into it
// must all resolve. DOCS_BROKEN renames the heading two of those links name.
const README = NAV + "\n\nSee [the setting](docs/knowledge/settings.md#the-setting).\n";
const DOCS = "# Settings\n\n[Jump to it](#the-setting), or back to [install](../../README.md#install-it).\n\n## The setting\n";
const DOCS_BROKEN = DOCS.replace("## The setting", "## A setting");

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

  test("reads a backtick line whose info string holds a backtick as text, not a fence", () => {
    assert.deepEqual([...headingSlugs("```x``` text\n\n## After\n")], ["after"]);
    assert.deepEqual([...headingSlugs("~~~ `js`\n## Hidden\n~~~\n## Shown\n")], ["shown"]);
  });
});

describe("anchorsIn", () => {
  test("finds html and markdown in-page links", () => {
    assert.deepEqual(anchorsIn('<a href="#a">x</a> and [y](#b)'), ["a", "b"]);
  });

  test("ignores links that leave the page", () => {
    assert.deepEqual(anchorsIn('<a href="https://x/#frag">x</a> [y](other.md)'), []);
  });

  test("ignores links written as inline code or in a fenced block", () => {
    const md = "[a](#a) `[b](#b)` ``[c](#c) ` x`` and\n```md\n[d](#d)\n````\n[e](#e)\n";
    assert.deepEqual(anchorsIn(md), ["a", "e"]);
  });

  test("does not join the text around a removed code span into a link", () => {
    assert.deepEqual(anchorsIn("[a]`x`(#b)"), []);
  });

  test("reads a backslash-escaped backtick as text, not as a code span", () => {
    assert.deepEqual(anchorsIn("\\`[a](#a) [b](#b)`"), ["a", "b"]);
    assert.deepEqual(anchorsIn("\\\\`[a](#a)` [b](#b)"), ["b"]);
  });

  test("ignores links in an indented code block, not in a paragraph or list it continues", () => {
    assert.deepEqual(anchorsIn("Text\n\n    [a](#a)\n\n    [b](#b)\n\t[c](#c)\n[d](#d)\n"), ["d"]);
    assert.deepEqual(anchorsIn("Text\n    [a](#a)\n"), ["a"]);
    assert.deepEqual(anchorsIn("- item\n\n    [a](#a)\n\n      [b](#b)\n"), ["a"]);
    assert.deepEqual(anchorsIn("- item\n\nText\n\n    [a](#a)\n"), []);
  });

  test("expands a tab to the next tab stop when measuring indentation", () => {
    // Two spaces and a tab reach column 4, not 6, so this stays a list paragraph.
    assert.deepEqual(anchorsIn("- item\n\n  \t[a](#a)\n"), ["a"]);
    assert.deepEqual(anchorsIn("- item\n\n \t \t[a](#a)\n"), []);
  });

  test("ignores Markdown links inside an HTML <code> element in an HTML block, nested ones included", () => {
    assert.deepEqual(anchorsIn('<p>\n<code>[a](#a) <a href="#b">b</a></code> [c](#c)\n</p>'), ["b", "c"]);
    assert.deepEqual(anchorsIn("<div><code>x <code>y</code> [a](#a)</code> [b](#b)"), ["b"]);
    assert.deepEqual(anchorsIn("<code>\n[a](#a)\n</code>\n\n[b](#b)"), ["b"]);
    assert.deepEqual(anchorsIn("<p><code>[a](#a)\n\n[b](#b)</code> <codex>[c](#c)</codex>"), ["a", "b", "c"]);
  });

  test("keeps links inside an inline HTML <code> element, which GitHub renders live", () => {
    assert.deepEqual(anchorsIn("See <code>[a](#a)</code> and <code>x <code>[b](#b)</code></code>"), ["a", "b"]);
    assert.deepEqual(anchorsIn("<code>[a](#a)</code> text"), ["a"]);
  });

  test("keeps links in a paragraph that continues a nested list item", () => {
    assert.deepEqual(anchorsIn("- a\n    - b\n\n      [x](#x) more\n"), ["x"]);
    assert.deepEqual(anchorsIn("  - a\n\n      - b\n\n        [x](#x)\n\n            [y](#y)\n"), ["x"]);
    assert.deepEqual(anchorsIn("- a\n  - b\n\n  [x](#x)\n\n      [y](#y)\n"), ["x"]);
  });

  test("recognises a tab-indented nested list item", () => {
    assert.deepEqual(anchorsIn("- a\n\t- b\n\n      [x](#x)\n\n              [y](#y)\n"), ["x"]);
  });

  test("measures a tab after the list marker to the next tab stop", () => {
    // "-\t" puts the content at column 4, so a paragraph there continues the item.
    assert.deepEqual(anchorsIn("-\tb\n\n    [x](#x)\n\n            [y](#y)\n"), ["x"]);
    assert.deepEqual(anchorsIn("1.\tb\n\n    [x](#x)\n"), ["x"]);
  });
});

describe("linkedAnchorsIn", () => {
  test("finds html and markdown links to another page's anchor", () => {
    assert.deepEqual(linkedAnchorsIn('[a](settings.md#x "title") <a href="../README.md#y">b</a>'),
      [["settings.md", "x"], ["../README.md", "y"]]);
  });

  test("ignores in-page anchors, URLs, root-relative paths and links with no anchor", () => {
    assert.deepEqual(linkedAnchorsIn("[a](#x) [b](https://x.org/a.md#y) [c](/a.md#z) [d](other.md)"), []);
  });

  test("ignores links written as code", () => {
    assert.deepEqual(linkedAnchorsIn("`[a](a.md#x)`\n~~~\n[b](b.md#y)\n~~~\n[c](c.md#z)"), [["c.md", "z"]]);
  });
});

describe("navRegion", () => {
  test("stops at the first section", () => {
    const region = navRegion("[a](#a)\n\n## First\n\n[b](#b)\n");
    assert.match(region, /#a/);
    assert.doesNotMatch(region, /#b/);
  });

  test("does not stop at a fenced \"## \" line above the first section", () => {
    const md = "```\n## Example\n```\n~~~\n## Another\n~~~\n[a](#a) [b](#b) [c](#c)\n\n## A\n## B\n## C\n";
    assert.deepEqual(anchorsIn(navRegion(md)), ["a", "b", "c"]);
    assert.deepEqual(checkMarkdown(md, "README.md"), []);
  });

  test("stops at a section indented by up to three spaces", () => {
    const region = navRegion("[a](#a)\n\n   ## First\n\n[b](#b)\n");
    assert.match(region, /#a/);
    assert.doesNotMatch(region, /#b/);
  });

  test("does not lose the rest of the page to an inline \"```x```\" line", () => {
    const md = "```x``` text [a](#a) [b](#b) [c](#c)\n\n## A\n## B\n## C\n";
    assert.deepEqual(anchorsIn(navRegion(md)), ["a", "b", "c"]);
    assert.deepEqual(checkMarkdown(md, "README.md"), []);
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

  test("asks no nav of a page that is not a front page", () => {
    assert.deepEqual(checkMarkdown("## One\n\n[a](#one)\n", "guide.md", { nav: false }), []);
  });

  test("resolves a link to another page's anchor against that page's headings", () => {
    const pages = { "../../README.md": README };
    const readLinked = (page) => pages[page] ?? null;
    assert.deepEqual(checkMarkdown(DOCS, "settings.md", { nav: false, readLinked }), []);
    const renamed = checkMarkdown(DOCS.replace("#install-it", "#installing"), "settings.md", { nav: false, readLinked });
    assert.equal(renamed.length, 1);
    assert.match(renamed[0], /"\.\.\/\.\.\/README\.md#installing" matches no heading/);
    const missing = checkMarkdown(DOCS.replace("../../README.md", "gone.md"), "settings.md", { nav: false, readLinked });
    assert.equal(missing.length, 1);
    assert.match(missing[0], /"gone\.md#install-it" points at a page that does not exist/);
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

  test("a broken anchor in any tracked page fails the staged check and pre-commit", () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "staged-pages-"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
    const git = (args) => cp.execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
    const docs = path.join(root, "docs", "knowledge", "settings.md");
    const run = (...args) => {
      const result = cp.spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS });
      if (result.error && result.error.code === "ETIMEDOUT") throw new Error(`${args.join(" ")} timed out after ${SPAWN_TIMEOUT_MS} ms`);
      return result;
    };
    try {
      git(["init", "-q"]);
      fs.mkdirSync(path.dirname(docs), { recursive: true });
      fs.writeFileSync(path.join(root, "README.md"), README);
      fs.writeFileSync(docs, DOCS);
      git(["add", "README.md", "docs"]);
      assert.equal(run(CHECK, "staged").status, 0);
      assert.equal(run(PRE_COMMIT).status, 0);
      // A fixture commit, so the README is no longer staged. It sets its own
      // identity and runs no hooks or signing from the machine it runs on.
      git(["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
        "commit", "-q", "--no-verify", "-m", "pages"]);

      // Only the docs page is staged; the README's link into it breaks too.
      fs.writeFileSync(docs, DOCS_BROKEN);
      git(["add", "docs"]);
      const bad = run(CHECK, "staged");
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /docs\/knowledge\/settings\.md \(staged\): "#the-setting" matches no heading/);
      assert.match(bad.stderr, /README\.md \(staged\): "docs\/knowledge\/settings\.md#the-setting" matches no heading/);
      assert.match(bad.stderr, /^\nMarkdown nav and anchor check:\n/);
      assert.equal(run(PRE_COMMIT).status, 1);

      // Fixed in the index, broken in the working tree: staged reads the
      // index, the no-argument form reads the working tree.
      fs.writeFileSync(docs, DOCS);
      git(["add", "docs"]);
      fs.writeFileSync(docs, DOCS_BROKEN);
      assert.equal(run(CHECK, "staged").status, 0);
      assert.equal(run(PRE_COMMIT).status, 0);
      assert.equal(run(CHECK).status, 1);
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
