"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { activate } = require("../scripts/activate-style.js");
const { shelf } = require("../scripts/list-styles.js");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hush-activate-style-"));
  const pluginRoot = path.join(root, "plugin");
  const projectDir = path.join(root, "project");
  const homeDir = path.join(root, "home");
  write(
    path.join(pluginRoot, "output-styles", "hush.md"),
    "---\nname: Hush\ndescription: Silent-by-default communication\nforce-for-plugin: true\n---\nbody\n"
  );
  return { pluginRoot, projectDir, homeDir };
}

test("activating a preset backs up stock and writes it into the forced slot", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Pirate voice. Unmeasured preset shipped with Hush.\n---\nARR body\n");

  const result = activate(presetPath, { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.name, "Hush Pirate");
  const hushMd = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf-8");
  assert.match(hushMd, /name: Hush Pirate/);
  assert.match(hushMd, /force-for-plugin: true/);
  assert.match(hushMd, /ARR body/);
  const backup = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8");
  assert.match(backup, /name: Hush\n/);
});

test("activating twice does not overwrite an existing stock backup", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nbody\n");
  const otherPath = path.join(pluginRoot, "styles", "rock.md");
  write(otherPath, "---\nname: Hush Rock\ndescription: Unmeasured preset shipped with Hush.\n---\nbody\n");

  activate(presetPath, { pluginRoot, projectDir, homeDir });
  activate(otherPath, { pluginRoot, projectDir, homeDir });

  const backup = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8");
  assert.match(backup, /name: Hush\n/);
});

test("restoring stock copies the backup back and requires one to exist", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  assert.throws(() => activate("stock", { pluginRoot, projectDir, homeDir }), /no stock backup/);

  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nbody\n");
  activate(presetPath, { pluginRoot, projectDir, homeDir });

  const result = activate("stock", { pluginRoot, projectDir, homeDir });
  assert.strictEqual(result.name, "Hush");
  const hushMd = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf-8");
  assert.match(hushMd, /name: Hush\n/);
});

test("restoring stock clears the backup, so no update warning follows", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nbody\n");
  activate(presetPath, { pluginRoot, projectDir, homeDir });

  const result = activate("stock", { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.backedUp, false);
  assert.strictEqual(fs.existsSync(path.join(pluginRoot, "output-styles", "hush.md.stock")), false);
  assert.strictEqual(shelf(pluginRoot, projectDir, homeDir).restoredOverTakeover, false);
});

test("a missing chosen file is an error, not a partial write", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const before = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf-8");
  assert.throws(() => activate(path.join(pluginRoot, "styles", "missing.md"), { pluginRoot, projectDir, homeDir }), /not found/);
  const after = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf-8");
  assert.strictEqual(before, after);
});

test("an outputStyle setting pointing at the activated style is stripped", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nbody\n");
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  write(settingsPath, JSON.stringify({ outputStyle: "Hush Pirate", model: "sonnet" }, null, 2) + "\n");

  const result = activate(presetPath, { pluginRoot, projectDir, homeDir });

  assert.deepStrictEqual(result.settingsUpdated, [settingsPath]);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  assert.strictEqual(settings.outputStyle, undefined);
  assert.strictEqual(settings.model, "sonnet");
});

test("an outputStyle setting pointing elsewhere is left untouched", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nbody\n");
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  write(settingsPath, JSON.stringify({ outputStyle: "Some Other Style" }, null, 2) + "\n");

  const result = activate(presetPath, { pluginRoot, projectDir, homeDir });

  assert.deepStrictEqual(result.settingsUpdated, []);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  assert.strictEqual(settings.outputStyle, "Some Other Style");
});
