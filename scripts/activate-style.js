#!/usr/bin/env node
"use strict";

// Mechanical swap for hush:pick-style. Replaces the skill's own file-edit
// instructions: this is the one place that backs up output-styles/hush.md,
// writes the chosen style into its forced slot, and strips any redundant
// outputStyle setting. The skill only picks which target to pass in.
//
// The swap is all-or-nothing: the chosen style is validated in full before the
// slot is touched, every write is atomic, and any failure puts the previously
// active style back. The one write outside the slot is --update-telemetry's
// mend to the chosen file, made before the swap, which it outlives.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { safeWriteFileSync } = require("../hooks/lib/safe-write.js");
const { splitFrontmatter, parseFrontmatter, normalize, sections, verify, verifyCore, telemetryUpdate, CRAFTED_MARKER, COLON_NAME_REASON, GUARDED_SECTIONS } = require("./verify-style.js");

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

// A crafted style lives in .claude/output-styles, where a selection names it by
// its bare name. Once that style holds the forced slot, the selection is
// redundant, so it goes. A namespaced value such as "hush:Hush" names a
// plugin's style, never the crafted copy, and it is the setting that turns on
// Claude Code's per-turn style reminder, so it always stays: no style that
// reaches the slot has a colon in its name, so the comparison never matches it.
function stripOutputStyle(settingsPath, targetName) {
  if (!fs.existsSync(settingsPath)) return false;
  const raw = fs.readFileSync(settingsPath, "utf-8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (
    typeof data.outputStyle !== "string" ||
    data.outputStyle.trim().toLowerCase() !== targetName.trim().toLowerCase()
  ) {
    return false;
  }
  delete data.outputStyle;
  safeWriteFileSync(settingsPath, withoutOutputStyle(raw, data));
  return true;
}

// Stock is the only style hush ships. Everything else is a user variant: it
// has to prove it kept hush's mechanics before it can hold the slot, and it
// may not answer to stock's own name. craft-style builds on the full frame and
// on the stripped one, so either verifier passing is enough.
function validateVariant(target, text, canonicalText) {
  const fm = parseFrontmatter(splitFrontmatter(normalize(text)).frontmatter);
  const name = (fm.name || "").trim().toLowerCase();
  // Claude Code names a plugin's style plugin:name, so a colon in the name
  // would show an id where a name belongs, on the shelf and in the record.
  if (name.includes(":"))
    throw new Error(`"${fm.name}" ${COLON_NAME_REASON} — rename this variant without one before activating it`);
  // Stock's name is taken: a variant wearing it makes the record and the slot
  // agree even after an update wrote over the takeover.
  const stockName = parseFrontmatter(splitFrontmatter(normalize(canonicalText)).frontmatter).name;
  if (stockName && stockName.trim().toLowerCase() === name)
    throw new Error(`"${fm.name}" is the name of the style hush ships — rename this variant before activating it`);
  if (keepsMechanics(canonicalText, text)) return frameGaps(canonicalText, text);
  // A style whose only gap is a retired telemetry paragraph is refused with
  // the mend attached, so the skill can offer it and --update-telemetry apply it.
  const update = telemetryUpdate(canonicalText, text);
  if (update && keepsMechanics(canonicalText, update.text)) {
    const err = new Error(`${target} has the paragraph about [hush ...] lines from an older hush, and activation needs the current one`);
    err.telemetryUpdate = { path: target, old: update.old, new: update.new };
    throw err;
  }
  throw new Error(`${target} did not keep hush's mechanics: ${verifyCore(canonicalText, text).problems.join("; ")}`);
}

function keepsMechanics(canonicalText, text) {
  return verify(canonicalText, text).ok || verifyCore(canonicalText, text).ok;
}

// A style that kept stock's sections was built on the full frame. When it
// holds only the core contract now, it lacks rules stock added since it was
// crafted, such as the 40-word block cap. It still activates, unchanged, and
// the gaps come back so the user can have them added in their own voice. A
// style on the stripped frame keeps none of those sections and reports none.
function frameGaps(canonicalText, text) {
  const kept = Object.keys(sections(splitFrontmatter(normalize(text)).body));
  if (!GUARDED_SECTIONS.some((name) => kept.includes(name))) return [];
  return verify(canonicalText, text).problems;
}

// updateTelemetry: the user agreed to the mend validateVariant offered. The
// style file gets it first, and only once the mended text passes, so a refusal
// leaves that file as it was.
function activate(target, { pluginRoot, projectDir, homeDir = os.homedir(), updateTelemetry = false }) {
  const hushPath = path.join(pluginRoot, "output-styles", "hush.md");
  const backupPath = hushPath + ".stock";
  const activePath = hushPath + ".active.json";
  const previous = fs.existsSync(hushPath) ? fs.readFileSync(hushPath, "utf-8") : null;

  // A marketplace update installs a fresh directory with no backup in it. A
  // checkout loaded in place keeps its backup when a pull rewrites the slot.
  // So stock in the slot that differs from its backup is the newer voice, and
  // it becomes the backup before anything is checked against it or restored
  // from it. A crafted style in the slot never becomes the backup.
  const slotIsStock =
    previous !== null &&
    !(parseFrontmatter(splitFrontmatter(normalize(previous)).frontmatter).description || "").includes(CRAFTED_MARKER);
  if (slotIsStock && fs.existsSync(backupPath) && fs.readFileSync(backupPath, "utf-8") !== previous) {
    fs.copyFileSync(hushPath, backupPath);
  }

  let next;
  let styleUpdated = null;
  let gaps = [];
  if (target === "stock") {
    if (!fs.existsSync(backupPath)) throw new Error(`no stock backup at ${backupPath} — nothing to restore`);
    next = fs.readFileSync(backupPath, "utf-8");
  } else {
    if (!fs.existsSync(target)) throw new Error(`chosen style file not found: ${target}`);
    let chosen = fs.readFileSync(target, "utf-8");
    // Stock lives in the backup once a takeover holds the slot, so that is the
    // canonical file to check a variant against.
    const canonical = fs.readFileSync(fs.existsSync(backupPath) ? backupPath : hushPath, "utf-8");
    if (updateTelemetry) {
      const update = telemetryUpdate(canonical, chosen);
      if (!update) throw new Error(`${target} has no paragraph about [hush ...] lines from an older hush to replace`);
      chosen = update.text;
    }
    gaps = validateVariant(target, chosen, canonical);
    if (updateTelemetry) {
      safeWriteFileSync(target, chosen);
      styleUpdated = target;
    }
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
    let rolledBack = previous === null;
    try {
      if (previous !== null) {
        safeWriteFileSync(hushPath, previous);
        rolledBack = true;
      }
    } catch {
      /* best-effort; the backup is the second way back, so it stays */
    }
    if (backupTaken && rolledBack) {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        /* best-effort */
      }
    }
    throw err;
  }

  // The swap is committed. A settings file that cannot be cleaned is a leftover
  // redundant setting, not a failed activation, so it is reported, not thrown.
  const settingsUpdated = [];
  const warnings = [];
  for (const p of [
    path.join(homeDir, ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.local.json"),
  ]) {
    try {
      if (stripOutputStyle(p, name)) settingsUpdated.push(p);
    } catch (err) {
      warnings.push(`could not remove the outputStyle setting from ${p}: ${err.message}`);
    }
  }

  return { ok: true, target, name, backedUp: fs.existsSync(backupPath), styleUpdated, frameGaps: gaps, settingsUpdated, warnings };
}

function main() {
  const args = process.argv.slice(2);
  const updateTelemetry = args.includes("--update-telemetry");
  const [target] = args.filter((a) => a !== "--update-telemetry");
  if (!target) {
    console.error('Usage: activate-style.js [--update-telemetry] <style-file-path>|"stock"');
    process.exit(1);
  }
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, "..");
  const projectDir = process.cwd();
  try {
    const result = activate(target, { pluginRoot, projectDir, updateTelemetry });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const refused = { ok: false, error: err.message };
    if (err.telemetryUpdate) refused.telemetryUpdate = err.telemetryUpdate;
    console.log(JSON.stringify(refused, null, 2));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { activate, frameGaps };
