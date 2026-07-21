#!/usr/bin/env node
"use strict";

// Mechanical swap for hush:pick-style. Replaces the skill's own file-edit
// instructions: this is the one place that backs up output-styles/hush.md,
// writes the chosen style into its forced slot, and strips any redundant
// outputStyle setting. The skill only picks which target to pass in.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { splitFrontmatter, parseFrontmatter, normalize } = require("./verify-style.js");

function injectForcePlugin(text) {
  const { frontmatter, body } = splitFrontmatter(normalize(text));
  if (frontmatter === null) throw new Error("chosen style file has no frontmatter");
  const lines = frontmatter.split("\n");
  if (!lines.some((l) => /^force-for-plugin:/.test(l))) lines.push("force-for-plugin: true");
  return `---\n${lines.join("\n")}\n---\n${body}`;
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
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + "\n");
  return true;
}

function activate(target, { pluginRoot, projectDir, homeDir = os.homedir() }) {
  const hushPath = path.join(pluginRoot, "output-styles", "hush.md");
  const backupPath = hushPath + ".stock";

  if (target === "stock") {
    if (!fs.existsSync(backupPath)) throw new Error(`no stock backup at ${backupPath} — nothing to restore`);
    fs.copyFileSync(backupPath, hushPath);
    fs.unlinkSync(backupPath);
  } else {
    if (!fs.existsSync(target)) throw new Error(`chosen style file not found: ${target}`);
    if (!fs.existsSync(backupPath)) fs.copyFileSync(hushPath, backupPath);
    fs.writeFileSync(hushPath, injectForcePlugin(fs.readFileSync(target, "utf-8")));
  }

  const finalFm = parseFrontmatter(splitFrontmatter(normalize(fs.readFileSync(hushPath, "utf-8"))).frontmatter);
  const targetName = finalFm.name || "Hush";

  const settingsUpdated = [
    path.join(homeDir, ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.local.json"),
  ].filter((p) => stripOutputStyle(p, targetName));

  return { ok: true, target, name: targetName, backedUp: fs.existsSync(backupPath), settingsUpdated };
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
