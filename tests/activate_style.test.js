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

// The stub stock file carries no `## ` sections, so a variant clears the core
// contract and not the full readability frame — the same shape craft-style's
// --core styles have, and the path activation falls back to.
const VALID_VARIANT = [
  "---",
  "name: Robo",
  "description: Robotic voice. Unmeasured variant of Hush.",
  "keep-coding-instructions: true",
  "---",
  "body",
  "",
  "Not one word between tool calls. Errors word for word.",
  "Quiet never means less work.",
  "",
].join("\n");

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

function slot(pluginRoot) {
  return fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf-8");
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

test("restoring stock keeps the pristine copy, so it restores again", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nbody\n");
  activate(presetPath, { pluginRoot, projectDir, homeDir });

  const result = activate("stock", { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.backedUp, true);
  assert.ok(fs.existsSync(path.join(pluginRoot, "output-styles", "hush.md.stock")));
  assert.strictEqual(shelf(pluginRoot, projectDir, homeDir).restoredOverTakeover, false);

  activate(presetPath, { pluginRoot, projectDir, homeDir });
  assert.strictEqual(activate("stock", { pluginRoot, projectDir, homeDir }).name, "Hush");
  assert.match(slot(pluginRoot), /name: Hush\n/);
});

test("a crafted variant that kept the mechanics activates", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = path.join(projectDir, ".claude", "output-styles", "robo.md");
  write(variantPath, VALID_VARIANT);

  const result = activate(variantPath, { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.name, "Robo");
  assert.match(slot(pluginRoot), /force-for-plugin: true/);
});

test("a variant that dropped hush's mechanics is refused, slot untouched", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = path.join(projectDir, ".claude", "output-styles", "bogus.md");
  write(variantPath, "---\nname: Bogus\ndescription: Unmeasured variant of Hush.\nkeep-coding-instructions: true\n---\nsay whatever\n");
  const before = slot(pluginRoot);

  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }), /did not keep hush's mechanics/);
  assert.strictEqual(slot(pluginRoot), before);
});

test("a variant answering to a shipped preset's name is refused", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  write(
    path.join(pluginRoot, "styles", "pirate.md"),
    "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nbody\n"
  );
  const variantPath = path.join(homeDir, ".claude", "output-styles", "mine.md");
  write(variantPath, VALID_VARIANT.replace("name: Robo", "name: hush pirate"));
  const before = slot(pluginRoot);

  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }), /is the name of a style hush ships/);
  assert.strictEqual(slot(pluginRoot), before);
});

test("a variant wearing the shipped-preset marker is refused", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = path.join(homeDir, ".claude", "output-styles", "fake.md");
  write(variantPath, VALID_VARIANT.replace("Unmeasured variant of Hush.", "Unmeasured preset shipped with Hush."));

  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }), /claims to be one/);
});

test("bundled styles are never modified by an activation", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  const preset = "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nARR body\n";
  write(presetPath, preset);

  activate(presetPath, { pluginRoot, projectDir, homeDir });
  activate("stock", { pluginRoot, projectDir, homeDir });

  assert.strictEqual(fs.readFileSync(presetPath, "utf-8"), preset);
});

// An interrupted swap: the slot is written, then the active-state record write
// fails on a path that cannot be replaced.
test("a write that fails mid-swap leaves the previous style active", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const first = path.join(pluginRoot, "styles", "pirate.md");
  write(first, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nARR body\n");
  const second = path.join(pluginRoot, "styles", "rock.md");
  write(second, "---\nname: Hush Rock\ndescription: Unmeasured preset shipped with Hush.\n---\nrock body\n");
  activate(first, { pluginRoot, projectDir, homeDir });
  const active = slot(pluginRoot);

  const recordPath = path.join(pluginRoot, "output-styles", "hush.md.active.json");
  fs.unlinkSync(recordPath);
  write(path.join(recordPath, "blocker"), "x");

  assert.throws(() => activate(second, { pluginRoot, projectDir, homeDir }));
  assert.strictEqual(slot(pluginRoot), active);
  assert.ok(fs.existsSync(path.join(pluginRoot, "output-styles", "hush.md.stock")));

  fs.rmSync(recordPath, { recursive: true });
  assert.strictEqual(activate("stock", { pluginRoot, projectDir, homeDir }).name, "Hush");
});

test("a settings file that cannot be cleaned warns, and the swap still stands", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nARR body\n");
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  write(path.join(settingsPath, "blocker"), "x");

  const result = activate(presetPath, { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.settingsUpdated, []);
  assert.strictEqual(result.warnings.length, 1);
  assert.match(result.warnings[0], /could not remove the outputStyle setting from/);
  assert.ok(result.warnings[0].includes(settingsPath));
  assert.match(slot(pluginRoot), /name: Hush Pirate/);
});

test("a clean activation warns about nothing", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nARR body\n");

  assert.deepStrictEqual(activate(presetPath, { pluginRoot, projectDir, homeDir }).warnings, []);
});

test("a variant answering to stock's own name is refused", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = path.join(homeDir, ".claude", "output-styles", "mine.md");
  write(variantPath, VALID_VARIANT.replace("name: Robo", "name: hush"));
  const before = slot(pluginRoot);

  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }), /is the name of a style hush ships/);
  assert.strictEqual(slot(pluginRoot), before);
});

// Windows resolves either casing to the same file, so a preset addressed in a
// different case is still a bundled preset and not a variant colliding with
// its own name.
test("a bundled preset addressed in another case still activates", { skip: process.platform !== "win32" }, () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nARR body\n");

  const result = activate(presetPath.toLowerCase(), { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.name, "Hush Pirate");
});

test("a rollback that also fails keeps the pristine stock copy", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nARR body\n");
  const stock = slot(pluginRoot);
  const realRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("rename blocked");
  };

  try {
    assert.throws(() => activate(presetPath, { pluginRoot, projectDir, homeDir }), /rename blocked/);
  } finally {
    fs.renameSync = realRename;
  }

  assert.strictEqual(fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8"), stock);
  assert.strictEqual(activate("stock", { pluginRoot, projectDir, homeDir }).name, "Hush");
});

test("a first activation that fails leaves no backup for the shelf to misread", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nARR body\n");
  write(path.join(pluginRoot, "output-styles", "hush.md.active.json", "blocker"), "x");

  assert.throws(() => activate(presetPath, { pluginRoot, projectDir, homeDir }));

  const result = shelf(pluginRoot, projectDir, homeDir);
  assert.strictEqual(result.stockBackupExists, false);
  assert.strictEqual(result.restoredOverTakeover, false);
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

test("stripping outputStyle keeps the rest of the settings file as the user wrote it", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const presetPath = path.join(pluginRoot, "styles", "pirate.md");
  write(presetPath, "---\nname: Hush Pirate\ndescription: Unmeasured preset shipped with Hush.\n---\nbody\n");
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  write(settingsPath, '{\n    "outputStyle": "Hush Pirate",\n    "env": {\n        "A": "1"\n    }\n}\n');

  activate(presetPath, { pluginRoot, projectDir, homeDir });

  assert.strictEqual(fs.readFileSync(settingsPath, "utf-8"), '{\n    "env": {\n        "A": "1"\n    }\n}\n');
});

// --- adversarial rollback -------------------------------------------------
//
// The happy path proves a swap lands. These prove the swap is all-or-nothing
// when it does not: an interrupted activation, a slot that cannot be written,
// and a second activation arriving on top of a half-finished one.

function preset(pluginRoot, file, name, body) {
  const p = path.join(pluginRoot, "styles", file);
  write(p, `---\nname: ${name}\ndescription: Unmeasured preset shipped with Hush.\n---\n${body}\n`);
  return p;
}

// safeWriteFileSync writes a dot-prefixed `.tmp` beside its target and renames
// it into place, so a half-written swap is visible as a leftover temp file.
function strays(pluginRoot) {
  return fs.readdirSync(path.join(pluginRoot, "output-styles")).filter((f) => f.endsWith(".tmp"));
}

test("a slot that cannot be written leaves the previous style active and named", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const first = preset(pluginRoot, "pirate.md", "Hush Pirate", "ARR body");
  const second = preset(pluginRoot, "rock.md", "Hush Rock", "rock body");
  activate(first, { pluginRoot, projectDir, homeDir });
  const active = slot(pluginRoot);
  const record = path.join(pluginRoot, "output-styles", "hush.md.active.json");
  const before = fs.readFileSync(record, "utf-8");

  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith("hush.md")) throw new Error("slot is not writable");
    return realRename(from, to);
  };
  try {
    assert.throws(() => activate(second, { pluginRoot, projectDir, homeDir }), /slot is not writable/);
  } finally {
    fs.renameSync = realRename;
  }

  assert.strictEqual(slot(pluginRoot), active, "the slot moved under a failed write");
  assert.strictEqual(fs.readFileSync(record, "utf-8"), before, "the record names a style that never took the slot");
  assert.deepStrictEqual(strays(pluginRoot), [], "a partial write was left behind");
});

test("a second activation over a half-finished one still refuses, and the slot never drifts", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const first = preset(pluginRoot, "pirate.md", "Hush Pirate", "ARR body");
  const second = preset(pluginRoot, "rock.md", "Hush Rock", "rock body");
  const third = preset(pluginRoot, "opera.md", "Hush Opera", "aria body");
  activate(first, { pluginRoot, projectDir, homeDir });
  const active = slot(pluginRoot);
  const stock = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8");

  // Interrupt: the record path is replaced by a directory, so the swap gets
  // as far as the slot and cannot finish.
  const record = path.join(pluginRoot, "output-styles", "hush.md.active.json");
  fs.unlinkSync(record);
  write(path.join(record, "blocker"), "x");

  assert.throws(() => activate(second, { pluginRoot, projectDir, homeDir }));
  assert.strictEqual(slot(pluginRoot), active);

  // A second attempt arriving on top of that half-finished one hits the same
  // wall, and neither the slot nor the pristine backup drifts.
  assert.throws(() => activate(third, { pluginRoot, projectDir, homeDir }));
  assert.strictEqual(slot(pluginRoot), active);
  assert.strictEqual(fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8"), stock);
  assert.deepStrictEqual(strays(pluginRoot), []);

  // Clear the interruption and the next activation completes normally, with
  // the slot and the record naming the same style.
  fs.rmSync(record, { recursive: true });
  const result = activate(third, { pluginRoot, projectDir, homeDir });
  assert.strictEqual(result.name, "Hush Opera");
  assert.match(slot(pluginRoot), /name: Hush Opera/);
  assert.strictEqual(JSON.parse(fs.readFileSync(record, "utf-8")).name, "Hush Opera");
  assert.strictEqual(fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8"), stock);
});

test("a refused variant leaves no temp file and no record behind", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = path.join(projectDir, ".claude", "output-styles", "bogus.md");
  write(variantPath, "---\nname: Bogus\ndescription: Unmeasured variant of Hush.\nkeep-coding-instructions: true\n---\nsay whatever\n");

  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }), /did not keep hush's mechanics/);

  assert.deepStrictEqual(strays(pluginRoot), []);
  assert.strictEqual(fs.existsSync(path.join(pluginRoot, "output-styles", "hush.md.active.json")), false);
  assert.strictEqual(fs.existsSync(path.join(pluginRoot, "output-styles", "hush.md.stock")), false);
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
