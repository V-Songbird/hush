#!/usr/bin/env node
"use strict";

// Mechanical shelf-reader for hush:pick-style. Replaces the skill's own
// prose-driven file scan: this is the one place that walks styles/,
// output-styles/hush.md, and the user's/project's crafted-style folders,
// and decides which entry is currently active. The skill only renders the
// JSON this prints — it makes no classification calls of its own.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { splitFrontmatter, parseFrontmatter, normalize } = require("./verify-style.js");

const PRESET_MARKER = "Unmeasured preset shipped with Hush.";
const CRAFTED_MARKER = "Unmeasured variant of Hush.";

function readFrontmatter(filePath) {
  const text = normalize(fs.readFileSync(filePath, "utf-8"));
  const { frontmatter } = splitFrontmatter(text);
  return parseFrontmatter(frontmatter);
}

function listMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .map((f) => path.join(dir, f))
    .sort();
}

function shelf(pluginRoot, projectDir, homeDir = os.homedir()) {
  const entries = [];

  for (const file of listMdFiles(path.join(pluginRoot, "styles"))) {
    const fm = readFrontmatter(file);
    entries.push({ name: fm.name || path.basename(file), description: fm.description || "", source: "shipped", path: file });
  }

  const hushPath = path.join(pluginRoot, "output-styles", "hush.md");
  entries.push({ name: "Hush (stock)", description: "The benchmarked default — no takeover.", source: "stock", path: "stock" });

  const craftedDirs = [path.join(homeDir, ".claude", "output-styles"), path.join(projectDir, ".claude", "output-styles")];
  const seen = new Set();
  for (const dir of craftedDirs) {
    for (const file of listMdFiles(dir)) {
      const resolved = path.resolve(file);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      const fm = readFrontmatter(file);
      if (!(fm.description || "").includes(CRAFTED_MARKER)) continue;
      entries.push({ name: fm.name || path.basename(file), description: fm.description || "", source: "crafted", path: file });
    }
  }

  const activeFm = fs.existsSync(hushPath) ? readFrontmatter(hushPath) : {};
  const activeDesc = activeFm.description || "";
  let activeIndex = entries.findIndex((e) => e.source === "stock");
  if (activeDesc.includes(PRESET_MARKER)) {
    const found = entries.findIndex((e) => e.source === "shipped" && e.name === activeFm.name);
    if (found !== -1) activeIndex = found;
  } else if (activeDesc.includes(CRAFTED_MARKER)) {
    const found = entries.findIndex((e) => e.source === "crafted" && e.name === activeFm.name);
    activeIndex = found !== -1 ? found : -1;
  }

  entries.forEach((e, i) => {
    e.index = i + 1;
    e.active = i === activeIndex;
  });

  const stockBackupExists = fs.existsSync(hushPath + ".stock");
  const activeOnShelf = activeIndex !== -1;

  return {
    styles: entries,
    activeName: activeFm.name || null,
    activeOnShelf,
    stockBackupExists,
    restoredOverTakeover: stockBackupExists && activeIndex !== -1 && entries[activeIndex].source === "stock",
  };
}

function main() {
  const args = process.argv.slice(2);
  const projectFlagIndex = args.indexOf("--project");
  const projectDir = projectFlagIndex !== -1 ? args[projectFlagIndex + 1] : process.cwd();
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, "..");
  console.log(JSON.stringify(shelf(pluginRoot, projectDir), null, 2));
}

if (require.main === module) main();

module.exports = { shelf };
