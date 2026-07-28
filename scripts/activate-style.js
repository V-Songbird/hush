#!/usr/bin/env node
"use strict";

// Mechanical swap for hush:pick-style. Replaces the skill's own file-edit
// instructions: this is the one place that backs up output-styles/hush.md,
// writes the chosen style into its forced slot, and strips any redundant
// outputStyle setting. The skill only picks which target to pass in.
//
// The swap is all-or-nothing: the chosen style is validated in full before the
// slot is touched, every write is atomic, and any failure puts the previously
// active style back.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { safeWriteFileSync } = require("../hooks/lib/safe-write.js");
const { splitFrontmatter, parseFrontmatter, normalize, verify, verifyCore } = require("./verify-style.js");
const { listMdFiles, readFrontmatter, PRESET_MARKER } = require("./list-styles.js");

function injectForcePlugin(text) {
  const { frontmatter, body } = splitFrontmatter(normalize(text));
  if (frontmatter === null) throw new Error("chosen style file has no frontmatter");
  const lines = frontmatter.split("\n");
  if (!lines.some((l) => /^force-for-plugin:/.test(l))) lines.push("force-for-plugin: true");
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

// A targeted line cut keeps the user's own formatting, and stands only when the
// result parses back to the same settings minus the one key. Anything else —
// the key written inline, last in the object, oddly wrapped — falls back to a
// stable two-space re-serialize, which reformats the file.
function withoutOutputStyle(raw, expected) {
  const cut = raw.replace(/^[ \t]*"outputStyle"[ \t]*:[ \t]*"[^"\\]*"[ \t]*,?[ \t]*\r?\n/m, "");
  if (cut !== raw) {
    try {
      if (JSON.stringify(JSON.parse(cut)) === JSON.stringify(expected)) return cut;
    } catch {
      /* fall through to the re-serialize */
    }
  }
  return JSON.stringify(expected, null, 2) + "\n";
}

function stripOutputStyle(settingsPath, targetName) {
  if (!fs.existsSync(settingsPath)) return false;
  const raw = fs.readFileSync(settingsPath, "utf-8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof data.outputStyle !== "string" || data.outputStyle.trim().toLowerCase() !== targetName.trim().toLowerCase()) {
    return false;
  }
  delete data.outputStyle;
  safeWriteFileSync(settingsPath, withoutOutputStyle(raw, data));
  return true;
}

function isBundled(target, pluginRoot) {
  return path.resolve(target).startsWith(path.resolve(pluginRoot, "styles") + path.sep);
}

// The presets under styles/ ship with the plugin and the suite verifies them.
// Everything else is a user variant: it has to prove it kept hush's mechanics
// before it can hold the slot, and it may not answer to a bundled style's name
// or wear the shipped-preset marker. craft-style builds on the full frame and
// on the stripped one, so either verifier passing is enough.
function validateVariant(target, text, canonicalText, pluginRoot) {
  const fm = parseFrontmatter(splitFrontmatter(normalize(text)).frontmatter);
  const name = (fm.name || "").trim().toLowerCase();
  for (const file of listMdFiles(path.join(pluginRoot, "styles"))) {
    const bundled = (readFrontmatter(file).name || "").trim().toLowerCase();
    if (bundled && bundled === name)
      throw new Error(`"${fm.name}" is the name of a style hush ships — rename this variant before activating it`);
  }
  if ((fm.description || "").includes(PRESET_MARKER))
    throw new Error(`${target} is not a style hush ships, but its description claims to be one`);
  if (verify(canonicalText, text).ok) return;
  const core = verifyCore(canonicalText, text);
  if (!core.ok) throw new Error(`${target} did not keep hush's mechanics: ${core.problems.join("; ")}`);
}

function activate(target, { pluginRoot, projectDir, homeDir = os.homedir() }) {
  const hushPath = path.join(pluginRoot, "output-styles", "hush.md");
  const backupPath = hushPath + ".stock";
  const activePath = hushPath + ".active.json";
  const previous = fs.existsSync(hushPath) ? fs.readFileSync(hushPath, "utf-8") : null;

  let next;
  if (target === "stock") {
    if (!fs.existsSync(backupPath)) throw new Error(`no stock backup at ${backupPath} — nothing to restore`);
    next = fs.readFileSync(backupPath, "utf-8");
  } else {
    if (!fs.existsSync(target)) throw new Error(`chosen style file not found: ${target}`);
    const chosen = fs.readFileSync(target, "utf-8");
    // Stock lives in the backup once a takeover holds the slot, so that is the
    // canonical file to check a variant against.
    if (!isBundled(target, pluginRoot))
      validateVariant(target, chosen, fs.readFileSync(fs.existsSync(backupPath) ? backupPath : hushPath, "utf-8"), pluginRoot);
    next = injectForcePlugin(chosen);
  }

  // Stock's one pristine copy, taken before the first takeover and never
  // consumed, so restoring stays available however often it is asked for.
  const backupTaken = previous !== null && !fs.existsSync(backupPath);
  if (backupTaken) fs.copyFileSync(hushPath, backupPath);

  const name = parseFrontmatter(splitFrontmatter(normalize(next)).frontmatter).name || "Hush";
  try {
    safeWriteFileSync(hushPath, next);
    safeWriteFileSync(activePath, JSON.stringify({ target, name }, null, 2) + "\n");
  } catch (err) {
    if (previous !== null) {
      try {
        safeWriteFileSync(hushPath, previous);
      } catch {
        /* best-effort; the backup is the second way back */
      }
    }
    if (backupTaken) {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        /* best-effort */
      }
    }
    throw err;
  }

  const settingsUpdated = [
    path.join(homeDir, ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.local.json"),
  ].filter((p) => stripOutputStyle(p, name));

  return { ok: true, target, name, backedUp: fs.existsSync(backupPath), settingsUpdated };
}

function main() {
  const [target] = process.argv.slice(2);
  if (!target) {
    console.error('Usage: activate-style.js <style-file-path>|"stock"');
    process.exit(1);
  }
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, "..");
  const projectDir = process.cwd();
  try {
    const result = activate(target, { pluginRoot, projectDir });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { activate };
