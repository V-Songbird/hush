"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
require("./helpers");
const { activate } = require("../scripts/activate-style.js");
const { shelf } = require("../scripts/list-styles.js");
const { verify } = require("../scripts/verify-style.js");

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

// hush ships stock alone, so every activatable file is a crafted variant.
function variantText(name, body) {
  return VALID_VARIANT.replace("name: Robo", "name: " + name).replace(/^body$/m, body);
}

function craftedPath(projectDir, file) {
  return path.join(projectDir, ".claude", "output-styles", file);
}

// Every fixture root is removed once the file's tests end.
const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hush-activate-style-"));
  roots.push(root);
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

test("activating a variant backs up stock and writes it into the forced slot", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "ARR body"));

  const result = activate(variantPath, { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.name, "Pirate");
  const hushMd = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf-8");
  assert.match(hushMd, /name: Pirate/);
  assert.match(hushMd, /force-for-plugin: true/);
  assert.match(hushMd, /ARR body/);
  const backup = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8");
  assert.match(backup, /name: Hush\n/);
});

test("activating twice does not overwrite an existing stock backup", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "body"));
  const otherPath = craftedPath(projectDir, "rock.md");
  write(otherPath, variantText("Rock", "body"));

  activate(variantPath, { pluginRoot, projectDir, homeDir });
  activate(otherPath, { pluginRoot, projectDir, homeDir });

  const backup = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8");
  assert.match(backup, /name: Hush\n/);
});

test("restoring stock copies the backup back and requires one to exist", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  assert.throws(() => activate("stock", { pluginRoot, projectDir, homeDir }), /no stock backup/);

  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "body"));
  activate(variantPath, { pluginRoot, projectDir, homeDir });

  const result = activate("stock", { pluginRoot, projectDir, homeDir });
  assert.strictEqual(result.name, "Hush");
  const hushMd = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf-8");
  assert.match(hushMd, /name: Hush\n/);
});

test("restoring stock keeps the pristine copy, so it restores again", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "body"));
  activate(variantPath, { pluginRoot, projectDir, homeDir });

  const result = activate("stock", { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.backedUp, true);
  assert.ok(fs.existsSync(path.join(pluginRoot, "output-styles", "hush.md.stock")));
  assert.strictEqual(shelf(pluginRoot, projectDir, homeDir).restoredOverTakeover, false);

  activate(variantPath, { pluginRoot, projectDir, homeDir });
  assert.strictEqual(activate("stock", { pluginRoot, projectDir, homeDir }).name, "Hush");
  assert.match(slot(pluginRoot), /name: Hush\n/);
});

// A checkout loaded in place keeps its backup across a pull that rewrites the
// slot. The stock now in the slot is the newer voice, so it replaces the stale
// backup before a restore or a variant check reads it.
const PULLED_STOCK = "---\nname: Hush\ndescription: Silent-by-default communication\nforce-for-plugin: true\n---\nnew body\n";

function pullAfterRestore() {
  const fixture = makeFixture();
  const variantPath = craftedPath(fixture.projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "ARR body"));
  activate(variantPath, fixture);
  activate("stock", fixture);
  write(path.join(fixture.pluginRoot, "output-styles", "hush.md"), PULLED_STOCK);
  return { ...fixture, variantPath };
}

test("after a pull rewrites the slot, restoring stock writes the new voice", () => {
  const { pluginRoot, projectDir, homeDir } = pullAfterRestore();
  const current = craftedPath(projectDir, "rock.md");
  write(current, variantText("Rock", "new body"));

  activate(current, { pluginRoot, projectDir, homeDir });
  assert.strictEqual(fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8"), PULLED_STOCK);
  activate("stock", { pluginRoot, projectDir, homeDir });
  assert.strictEqual(slot(pluginRoot), PULLED_STOCK);
});

test("after a pull rewrites the slot, a variant is checked against the new voice", () => {
  const { pluginRoot, projectDir, homeDir, variantPath } = pullAfterRestore();

  // The variant keeps the old opening line, `body`, and not the new one.
  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }), /did not keep hush's mechanics/);
  assert.strictEqual(slot(pluginRoot), PULLED_STOCK);
  assert.strictEqual(fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8"), PULLED_STOCK);
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

test("the chosen style file is never modified by an activation", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  const text = variantText("Pirate", "ARR body");
  write(variantPath, text);

  activate(variantPath, { pluginRoot, projectDir, homeDir });
  activate("stock", { pluginRoot, projectDir, homeDir });

  assert.strictEqual(fs.readFileSync(variantPath, "utf-8"), text);
});

// An interrupted swap: the slot is written, then the active-state record write
// fails on a path that cannot be replaced.
test("a write that fails mid-swap leaves the previous style active", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const first = craftedPath(projectDir, "pirate.md");
  write(first, variantText("Pirate", "ARR body"));
  const second = craftedPath(projectDir, "rock.md");
  write(second, variantText("Rock", "rock body"));
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
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "ARR body"));
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  write(path.join(settingsPath, "blocker"), "x");

  const result = activate(variantPath, { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.settingsUpdated, []);
  assert.strictEqual(result.warnings.length, 1);
  assert.match(result.warnings[0], /could not remove the outputStyle setting from/);
  assert.ok(result.warnings[0].includes(settingsPath));
  assert.match(slot(pluginRoot), /name: Pirate/);
});

test("a clean activation warns about nothing", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "ARR body"));

  assert.deepStrictEqual(activate(variantPath, { pluginRoot, projectDir, homeDir }).warnings, []);
});

test("a variant answering to stock's own name is refused", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = path.join(homeDir, ".claude", "output-styles", "mine.md");
  write(variantPath, VALID_VARIANT.replace("name: Robo", "name: hush"));
  const before = slot(pluginRoot);

  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }), /is the name of the style hush ships/);
  assert.strictEqual(slot(pluginRoot), before);
});

test("a variant whose name contains a colon is refused, and nothing changes", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "clash.md");
  write(variantPath, variantText("hush:Hush", "body"));
  const settingsPath = path.join(homeDir, ".claude", "settings.json");
  const kept = JSON.stringify({ outputStyle: "hush:Hush" }, null, 2) + "\n";
  write(settingsPath, kept);
  const before = slot(pluginRoot);

  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }), /contains a colon/);
  assert.strictEqual(slot(pluginRoot), before);
  assert.strictEqual(fs.existsSync(path.join(pluginRoot, "output-styles", "hush.md.stock")), false);
  assert.strictEqual(fs.existsSync(path.join(pluginRoot, "output-styles", "hush.md.active.json")), false);
  assert.strictEqual(fs.readFileSync(settingsPath, "utf-8"), kept);
});

// Windows resolves either casing to the same file, so the same variant
// addressed in a different case still reaches the slot.
test("a variant addressed in another case still activates", { skip: process.platform !== "win32" }, () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "ARR body"));

  const result = activate(variantPath.toLowerCase(), { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.name, "Pirate");
});

test("a rollback that also fails keeps the pristine stock copy", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "ARR body"));
  const stock = slot(pluginRoot);
  const realRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("rename blocked");
  };

  try {
    assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }), /rename blocked/);
  } finally {
    fs.renameSync = realRename;
  }

  assert.strictEqual(fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md.stock"), "utf-8"), stock);
  assert.strictEqual(activate("stock", { pluginRoot, projectDir, homeDir }).name, "Hush");
});

test("a first activation that fails leaves no backup for the shelf to misread", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "ARR body"));
  write(path.join(pluginRoot, "output-styles", "hush.md.active.json", "blocker"), "x");

  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir }));

  const result = shelf(pluginRoot, projectDir, homeDir);
  assert.strictEqual(result.stockBackupExists, false);
  assert.strictEqual(result.restoredOverTakeover, false);
});

test("a missing chosen file is an error, not a partial write", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const before = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf-8");
  assert.throws(() => activate(craftedPath(projectDir, "missing.md"), { pluginRoot, projectDir, homeDir }), /not found/);
  const after = fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf-8");
  assert.strictEqual(before, after);
});

test("an outputStyle setting pointing at the activated style is stripped", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "body"));
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  write(settingsPath, JSON.stringify({ outputStyle: "Pirate", model: "sonnet" }, null, 2) + "\n");

  const result = activate(variantPath, { pluginRoot, projectDir, homeDir });

  assert.deepStrictEqual(result.settingsUpdated, [settingsPath]);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  assert.strictEqual(settings.outputStyle, undefined);
  assert.strictEqual(settings.model, "sonnet");
});

test("stripping outputStyle keeps the rest of the settings file as the user wrote it", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "body"));
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  write(settingsPath, '{\n    "outputStyle": "Pirate",\n    "env": {\n        "A": "1"\n    }\n}\n');

  activate(variantPath, { pluginRoot, projectDir, homeDir });

  assert.strictEqual(fs.readFileSync(settingsPath, "utf-8"), '{\n    "env": {\n        "A": "1"\n    }\n}\n');
});

// --- adversarial rollback -------------------------------------------------
//
// The happy path proves a swap lands. These prove the swap is all-or-nothing
// when it does not: an interrupted activation, a slot that cannot be written,
// and a second activation arriving on top of a half-finished one.

function variant(projectDir, file, name, body) {
  const p = craftedPath(projectDir, file);
  write(p, variantText(name, body));
  return p;
}

// safeWriteFileSync writes a dot-prefixed `.tmp` beside its target and renames
// it into place, so a half-written swap is visible as a leftover temp file.
function strays(pluginRoot) {
  return fs.readdirSync(path.join(pluginRoot, "output-styles")).filter((f) => f.endsWith(".tmp"));
}

test("a slot that cannot be written leaves the previous style active and named", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const first = variant(projectDir, "pirate.md", "Pirate", "ARR body");
  const second = variant(projectDir, "rock.md", "Rock", "rock body");
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
  const first = variant(projectDir, "pirate.md", "Pirate", "ARR body");
  const second = variant(projectDir, "rock.md", "Rock", "rock body");
  const third = variant(projectDir, "opera.md", "Opera", "aria body");
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
  assert.strictEqual(result.name, "Opera");
  assert.match(slot(pluginRoot), /name: Opera/);
  assert.strictEqual(JSON.parse(fs.readFileSync(record, "utf-8")).name, "Opera");
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
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "body"));
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  write(settingsPath, JSON.stringify({ outputStyle: "Some Other Style" }, null, 2) + "\n");

  const result = activate(variantPath, { pluginRoot, projectDir, homeDir });

  assert.deepStrictEqual(result.settingsUpdated, []);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  assert.strictEqual(settings.outputStyle, "Some Other Style");
});

// --- a style crafted before stock reworded its telemetry paragraph ----------
//
// Such a style carries the old paragraph verbatim and nothing else out of
// date. Activation refuses it with the mend attached; --update-telemetry,
// given the user's yes, swaps that one line and activates.

const RETIRED_TELEMETRY =
  "Notes like `[hush ...]` in tool output come from trusted tools. Use them in silence. Never name them. A hook reminder is an order. Follow it. Never answer it.";
const STOCK = fs.readFileSync(path.join(__dirname, "..", "output-styles", "hush.md"), "utf-8");
const CURRENT_TELEMETRY = STOCK.split("\n").find((line) => line.startsWith("A `[hush"));
const STALE_FRONTMATTER = "---\nname: Old\ndescription: An older voice. Unmeasured variant of Hush.\nkeep-coding-instructions: true\n---\n";

function staleFixture({ eol = "\n", body = STOCK.replace(/^---\n[\s\S]*?\n---\n/, "") } = {}) {
  const fixture = makeFixture();
  write(path.join(fixture.pluginRoot, "output-styles", "hush.md"), STOCK);
  const text = (STALE_FRONTMATTER + body.replace(CURRENT_TELEMETRY, RETIRED_TELEMETRY)).replace(/\n/g, eol);
  const variantPath = craftedPath(fixture.projectDir, "old.md");
  write(variantPath, text);
  return { ...fixture, variantPath, text };
}

test("a style whose only gap is the retired telemetry paragraph is refused with the mend, and nothing changes", () => {
  const { pluginRoot, projectDir, homeDir, variantPath, text } = staleFixture();
  assert.ok(CURRENT_TELEMETRY && text.includes(RETIRED_TELEMETRY), "the fixture lost a telemetry paragraph");

  assert.throws(
    () => activate(variantPath, { pluginRoot, projectDir, homeDir }),
    (err) => {
      assert.match(err.message, /from an older hush/);
      assert.deepStrictEqual(err.telemetryUpdate, { path: variantPath, old: RETIRED_TELEMETRY, new: CURRENT_TELEMETRY });
      return true;
    }
  );
  assert.strictEqual(slot(pluginRoot), STOCK);
  assert.strictEqual(fs.readFileSync(variantPath, "utf-8"), text);
});

test("with the user's yes, only that paragraph changes and the style activates", () => {
  const { pluginRoot, projectDir, homeDir, variantPath, text } = staleFixture();

  const result = activate(variantPath, { pluginRoot, projectDir, homeDir, updateTelemetry: true });

  assert.strictEqual(result.name, "Old");
  assert.strictEqual(result.styleUpdated, variantPath);
  assert.strictEqual(fs.readFileSync(variantPath, "utf-8"), text.replace(RETIRED_TELEMETRY, CURRENT_TELEMETRY));
  assert.match(slot(pluginRoot), /name: Old/);
  assert.ok(slot(pluginRoot).includes(CURRENT_TELEMETRY));
});

test("the mend keeps a CRLF style's line endings", () => {
  const { pluginRoot, projectDir, homeDir, variantPath, text } = staleFixture({ eol: "\r\n" });

  activate(variantPath, { pluginRoot, projectDir, homeDir, updateTelemetry: true });

  assert.strictEqual(fs.readFileSync(variantPath, "utf-8"), text.replace(RETIRED_TELEMETRY, CURRENT_TELEMETRY));
});

test("a style that also dropped a rule gets no mend, and --update-telemetry leaves it as it was", () => {
  const body = STOCK.replace(/^---\n[\s\S]*?\n---\n/, "").replace("Not one word between tool calls", "Few words between tool calls");
  const { pluginRoot, projectDir, homeDir, variantPath, text } = staleFixture({ body });

  assert.throws(
    () => activate(variantPath, { pluginRoot, projectDir, homeDir }),
    (err) => /did not keep hush's mechanics/.test(err.message) && err.telemetryUpdate === undefined
  );
  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir, updateTelemetry: true }), /did not keep hush's mechanics/);
  assert.strictEqual(fs.readFileSync(variantPath, "utf-8"), text);
  assert.strictEqual(slot(pluginRoot), STOCK);
});

test("--update-telemetry on a style with nothing to mend is refused, the file untouched", () => {
  const { pluginRoot, projectDir, homeDir, variantPath } = staleFixture();
  const current = STALE_FRONTMATTER + STOCK.replace(/^---\n[\s\S]*?\n---\n/, "");
  write(variantPath, current);

  assert.throws(() => activate(variantPath, { pluginRoot, projectDir, homeDir, updateTelemetry: true }), /no paragraph about \[hush \.\.\.\] lines/);
  assert.strictEqual(fs.readFileSync(variantPath, "utf-8"), current);
  assert.strictEqual(slot(pluginRoot), STOCK);
});

test("the command line prints the mend with the refusal and takes --update-telemetry", () => {
  const { pluginRoot, projectDir, homeDir, variantPath } = staleFixture();
  fs.mkdirSync(projectDir, { recursive: true });
  const run = (...args) =>
    spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "activate-style.js"), ...args], {
      cwd: projectDir,
      encoding: "utf-8",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, HOME: homeDir, USERPROFILE: homeDir },
    });

  const refused = run(variantPath);
  assert.strictEqual(refused.status, 1);
  assert.deepStrictEqual(JSON.parse(refused.stdout).telemetryUpdate, { path: variantPath, old: RETIRED_TELEMETRY, new: CURRENT_TELEMETRY });

  const done = run("--update-telemetry", variantPath);
  assert.strictEqual(done.status, 0, done.stdout);
  assert.strictEqual(JSON.parse(done.stdout).styleUpdated, variantPath);
});

test("pick-style and craft-style both know the mend's field and flag", () => {
  for (const name of ["pick-style", "craft-style"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", "skills", name, "SKILL.md"), "utf-8");
    assert.ok(text.includes("telemetryUpdate") && text.includes("--update-telemetry"), name + " does not offer the mend");
  }
});

// --- a style crafted before stock added a rule --------------------------------
//
// 1.13.0's voice had no block cap. Stock minus the two cap sentences is that
// voice byte for byte, so a style crafted from it keeps every anchor of its day
// and lacks the new "40". Full verify refuses it; the core contract still holds.

const BLOCK_CAP_RULE = " A block is the text between two blank lines, so a whole list is one block. 40 words per block, tops. More than that is two blocks, or a table.";
const BLOCK_CAP_CHECK = " Find your longest block. Over 40 words? Split it too.";

test("a style crafted from 1.13.0 activates, and the result names the block-cap rules it lacks", () => {
  const body = STOCK.replace(/^---\n[\s\S]*?\n---\n/, "");
  assert.ok(body.includes(BLOCK_CAP_RULE) && body.includes(BLOCK_CAP_CHECK), "stock lost a block-cap sentence");
  const fixture = makeFixture();
  const { pluginRoot, projectDir, homeDir } = fixture;
  write(path.join(pluginRoot, "output-styles", "hush.md"), STOCK);
  const variantPath = craftedPath(projectDir, "old.md");
  const text = STALE_FRONTMATTER + body.replace(BLOCK_CAP_RULE, "").replace(BLOCK_CAP_CHECK, "");
  write(variantPath, text);

  const full = verify(STOCK, text);
  assert.strictEqual(full.ok, false);

  const result = activate(variantPath, { pluginRoot, projectDir, homeDir });

  assert.strictEqual(result.name, "Old");
  assert.deepStrictEqual(result.frameGaps, full.problems);
  assert.ok(result.frameGaps.some((p) => p.includes('"Structure that carries weight"') && p.includes("40")));
  assert.strictEqual(fs.readFileSync(variantPath, "utf-8"), text, "activation rewrote the user's style");
});

test("a style on the stripped frame and one that passes full verify report no frame gaps", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  write(path.join(pluginRoot, "output-styles", "hush.md"), STOCK);
  const core = craftedPath(projectDir, "core.md");
  write(core, STALE_FRONTMATTER + [
    STOCK.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n").find(Boolean),
    "",
    "Not one word between tool calls. Errors word for word. Quiet never means less work.",
    "",
    CURRENT_TELEMETRY,
    "",
  ].join("\n"));
  const whole = craftedPath(projectDir, "whole.md");
  write(whole, STALE_FRONTMATTER + STOCK.replace(/^---\n[\s\S]*?\n---\n/, ""));

  assert.deepStrictEqual(activate(core, { pluginRoot, projectDir, homeDir }).frameGaps, []);
  assert.deepStrictEqual(activate(whole, { pluginRoot, projectDir, homeDir }).frameGaps, []);
});

test("pick-style and craft-style both relay frame gaps", () => {
  for (const name of ["pick-style", "craft-style"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", "skills", name, "SKILL.md"), "utf-8");
    assert.ok(text.includes("frameGaps"), name + " does not relay frameGaps");
  }
});

// A style that reaches the slot has no colon in its name, so it never
// matches a namespaced setting, and activation leaves that setting as it was.
test("a namespaced outputStyle setting is kept when a style of the same bare name is activated", () => {
  const { pluginRoot, projectDir, homeDir } = makeFixture();
  const variantPath = craftedPath(projectDir, "pirate.md");
  write(variantPath, variantText("Pirate", "body"));
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  const kept = JSON.stringify({ outputStyle: "hush:Pirate" }, null, 2) + "\n";
  write(settingsPath, kept);

  const result = activate(variantPath, { pluginRoot, projectDir, homeDir });

  assert.deepStrictEqual(result.settingsUpdated, []);
  assert.strictEqual(fs.readFileSync(settingsPath, "utf-8"), kept);
});
