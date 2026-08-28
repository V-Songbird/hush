"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { shelf } = require("../scripts/list-styles.js");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hush-list-styles-"));
  const pluginRoot = path.join(root, "plugin");
  const projectDir = path.join(root, "project");
  const homeDir = path.join(root, "home");

  write(
    path.join(pluginRoot, "output-styles", "hush.md"),
    "---\nname: Hush\ndescription: Silent-by-default communication\nforce-for-plugin: true\n---\nbody\n"
  );
  return { root, pluginRoot, projectDir, homeDir };
}

test("stock is active when hush.md carries neither marker", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const result = shelf(pluginRoot, projectDir, homeDir);
  const active = result.styles.find((s) => s.active);
  assert.strictEqual(active.source, "stock");
  assert.strictEqual(result.stockBackupExists, false);
  assert.strictEqual(result.restoredOverTakeover, false);
});

test("stock alone is on the shelf until something is crafted", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const result = shelf(pluginRoot, projectDir, homeDir);
  assert.deepStrictEqual(
    result.styles.map((s) => [s.name, s.source, s.index]),
    [["Hush (stock)", "stock", 1]]
  );
});

// hush shipped four preset voices until 1.10.0. A style folder left behind by
// that install must not reappear on the shelf.
test("a leftover styles/ folder from an older install is ignored", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  write(
    path.join(pluginRoot, "styles", "pirate.md"),
    "---\nname: Hush Pirate\ndescription: Pirate voice. Unmeasured preset shipped with Hush.\n---\nbody\n"
  );
  const result = shelf(pluginRoot, projectDir, homeDir);
  assert.deepStrictEqual(result.styles.map((s) => s.name), ["Hush (stock)"]);
});

test("a crafted style in the project dir is listed and, once forced, detected as active", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  write(
    path.join(projectDir, ".claude", "output-styles", "robo.md"),
    "---\nname: Robo\ndescription: Robotic voice. Unmeasured variant of Hush.\n---\nbody\n"
  );
  let result = shelf(pluginRoot, projectDir, homeDir);
  assert.ok(result.styles.some((s) => s.name === "Robo" && s.source === "crafted"));

  write(
    path.join(pluginRoot, "output-styles", "hush.md"),
    "---\nname: Robo\ndescription: Robotic voice. Unmeasured variant of Hush.\nforce-for-plugin: true\n---\nbody\n"
  );
  result = shelf(pluginRoot, projectDir, homeDir);
  const active = result.styles.find((s) => s.active);
  assert.strictEqual(active.name, "Robo");
  assert.strictEqual(active.source, "crafted");
  assert.strictEqual(result.activeOnShelf, true);
});

test("a file without the crafted marker is not listed as a crafted style", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  write(path.join(projectDir, ".claude", "output-styles", "stray.md"), "---\nname: Stray\ndescription: not a hush style\n---\nbody\n");
  const result = shelf(pluginRoot, projectDir, homeDir);
  assert.ok(!result.styles.some((s) => s.name === "Stray"));
});

test("an active crafted style whose file was removed is flagged as off the shelf", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  write(
    path.join(pluginRoot, "output-styles", "hush.md"),
    "---\nname: Gone\ndescription: Unmeasured variant of Hush.\nforce-for-plugin: true\n---\nbody\n"
  );
  const result = shelf(pluginRoot, projectDir, homeDir);
  assert.strictEqual(result.activeOnShelf, false);
  assert.strictEqual(result.activeName, "Gone");
});

test("restoredOverTakeover is true only when a backup exists and stock is currently active", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  fs.writeFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "backup");
  const result = shelf(pluginRoot, projectDir, homeDir);
  assert.strictEqual(result.stockBackupExists, true);
  assert.strictEqual(result.restoredOverTakeover, true);
});

test("a recorded stock restore is not read as an update overwriting a takeover", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  fs.writeFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "backup");
  write(path.join(pluginRoot, "output-styles", "hush.md.active.json"), JSON.stringify({ target: "stock", name: "Hush" }));
  assert.strictEqual(shelf(pluginRoot, projectDir, homeDir).restoredOverTakeover, false);
});

test("a recorded style the slot no longer runs is read as overwritten", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  fs.writeFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "backup");
  write(
    path.join(pluginRoot, "output-styles", "hush.md.active.json"),
    JSON.stringify({ target: path.join(pluginRoot, "styles", "pirate.md"), name: "Hush Pirate" })
  );
  assert.strictEqual(shelf(pluginRoot, projectDir, homeDir).restoredOverTakeover, true);
});

test("every listed entry carries its provenance", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  write(
    path.join(projectDir, ".claude", "output-styles", "robo.md"),
    "---\nname: Robo\ndescription: Robotic voice. Unmeasured variant of Hush.\n---\nbody\n"
  );
  const result = shelf(pluginRoot, projectDir, homeDir);
  assert.deepStrictEqual(
    result.styles.map((s) => [s.name, s.source]),
    [
      ["Hush (stock)", "stock"],
      ["Robo", "crafted"],
    ]
  );
});
