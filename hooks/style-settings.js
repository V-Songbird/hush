#!/usr/bin/env node
"use strict";

// The message-format settings /hush:config writes, and the SessionStart hook
// that hands them to the model.
//
// Each default is what the style file already says, so the hook stays
// silent until a knob moves: a user who never runs the command pays
// nothing. A moved knob maps to one text, modules/<knob>-<value>.md, and
// the hook sends those texts under one header. No knob can remove the
// floor: a blocker, a pending approval, an unverified claim or anything
// left unchecked. The header and the style file both say so.
//
// A preset sets every knob at once; pairs after it on the same line win.
//
// SessionStart also fires after compaction (source "compact"), so the
// settings come back after the summary drops them.
//
//   node style-settings.js               SessionStart hook, payload on stdin
//   node style-settings.js show          the current settings as JSON
//   node style-settings.js presets       every preset as JSON
//   node style-settings.js set k=v ...   check, save, print the new reminder;
//                                        preset=<name> is one of the pairs
//   node style-settings.js reset         every knob back to its default

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readInput, emitContext } = require("./lib/harness");
const { isOn } = require("./lib/gate");

// The first value of each knob is its default. The order is the order the
// modules reach the model.
const KNOBS = {
  next: ["end", "top", "off"],
  rules: ["on", "off"],
  detail: ["normal", "short", "full", "bare"],
  why: ["on", "off"],
  checks: ["line", "each", "off"],
  caveats: ["each", "floor"],
  records: ["line", "off"],
  terms: ["footnote", "inline", "none"],
  markdown: ["rich", "basic", "plain"],
  files: ["card", "link"],
  sentences: ["12", "20"],
  emoji: ["off", "on"],
  headers: ["off", "on"],
  box: ["decisions", "work", "text"],
};
const DEFAULTS = Object.fromEntries(Object.entries(KNOBS).map(([k, v]) => [k, v[0]]));
const PRESETS = {
  standard: { ...DEFAULTS },
  minimal: { ...DEFAULTS, detail: "bare", why: "off", checks: "off", caveats: "floor", records: "off" },
  explainer: { ...DEFAULTS, next: "off", detail: "full", terms: "inline", sentences: "20" },
  terminal: { ...DEFAULTS, markdown: "plain", box: "text" },
};
const MODULES = path.join(__dirname, "..", "modules");
const HEADER =
  "hush settings, chosen by the user with /hush:config. Each one replaces only the rule it names. The rest of the Hush style stays. No setting removes a blocker, a pending approval, an unverified claim or anything left unchecked.";

function configPath() {
  return process.env.HUSH_CONFIG_FILE || path.join(os.homedir(), ".claude", "hush", "config.json");
}

// A missing, broken or hand-edited file never breaks a session: any value
// that is not a known one falls back to the default.
function load() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    /* no file yet, or unreadable: defaults */
  }
  const out = { ...DEFAULTS };
  for (const k of Object.keys(KNOBS)) if (saved && KNOBS[k].includes(saved[k])) out[k] = saved[k];
  return out;
}

function parse(pairs, base) {
  const settings = { ...base };
  const errors = [];
  for (const pair of pairs) {
    const parts = pair.split("=");
    const [k, v] = parts;
    if (parts.length !== 2) errors.push(`"${pair}" is not one knob=value pair`);
    else if (k === "preset") {
      if (Object.hasOwn(PRESETS, v)) Object.assign(settings, PRESETS[v]);
      else errors.push(`preset takes ${Object.keys(PRESETS).join(" | ")}, not "${v}"`);
    } else if (!Object.hasOwn(KNOBS, k)) errors.push(`unknown knob "${k}"; knobs: ${Object.keys(KNOBS).join(", ")}`);
    else if (!KNOBS[k].includes(v)) errors.push(`${k} takes ${KNOBS[k].join(" | ")}, not "${v}"`);
    else settings[k] = v;
  }
  return { settings, errors };
}

function compose(settings) {
  const parts = Object.keys(KNOBS)
    .filter((k) => settings[k] !== DEFAULTS[k])
    .map((k) => fs.readFileSync(path.join(MODULES, `${k}-${settings[k]}.md`), "utf8").trim());
  return parts.length ? [HEADER, ...parts].join("\n\n") : "";
}

// The voice's sections on what the desktop app draws and opens (footnotes,
// math, file cards, app links, widgets, panes, the task list, the next-step
// box) name forms and tools a terminal session does not have. They live in
// voice-app.md, not in the style file, so a terminal session does not carry
// them in every request. Every other host gets them here, at session start
// and again after compaction. Only the interactive terminal (cli) and print
// mode, `claude -p` (sdk-cli), are skipped: an entrypoint this code does not
// know keeps the whole voice.
const APP_PART = path.join(__dirname, "voice-app.md");
const APP_HEADER =
  "hush voice, app part: these sections are part of the Hush output style and carry the same weight as it. They add what the Claude desktop app draws and opens. They sit between its sections \"Structure that carries weight\" and \"How you sound\".";
const NO_APP = new Set(["cli", "sdk-cli"]);
function inTerminal() {
  return NO_APP.has(String(process.env.CLAUDE_CODE_ENTRYPOINT || "").trim());
}
function appPart() {
  if (inTerminal()) return "";
  // The rarer forms load on demand; the model needs their absolute path.
  const forms = path.join(__dirname, "voice-app-forms.md").replace(/\\/g, "/");
  return `${APP_HEADER}\n\n${fs.readFileSync(APP_PART, "utf8").trim().replaceAll("{{forms}}", forms)}`;
}

function save(settings) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
}

function hook() {
  try {
    if (isOn("HUSH_DISABLE")) return;
    readInput(); // the payload carries nothing these settings need
    const text = [appPart(), compose(load())].filter(Boolean).join("\n\n");
    if (text) emitContext("SessionStart", text);
  } catch {
    /* fail-open: a session starts without settings rather than not at all */
  }
}

function cli(args) {
  const [cmd, ...rest] = args;
  if (cmd === "show") {
    process.stdout.write(JSON.stringify(load(), null, 2) + "\n");
    return 0;
  }
  if (cmd === "presets") {
    process.stdout.write(JSON.stringify(PRESETS, null, 2) + "\n");
    return 0;
  }
  if (cmd === "reset" || cmd === "set") {
    const { settings, errors } = cmd === "reset" ? { settings: { ...DEFAULTS }, errors: [] } : parse(rest, load());
    if (errors.length) {
      process.stderr.write(errors.join("\n") + "\n");
      return 2;
    }
    save(settings);
    const text = compose(settings);
    process.stdout.write((text || "Every hush setting is at its default. The style file alone applies.") + "\n");
    return 0;
  }
  process.stderr.write("usage: style-settings.js [show | presets | set [preset=name] knob=value ... | reset]\n");
  return 2;
}

if (require.main === module) {
  if (process.argv.length > 2) process.exitCode = cli(process.argv.slice(2));
  else hook();
}

module.exports = { KNOBS, DEFAULTS, PRESETS, HEADER, APP_HEADER, appPart, load, parse, compose, configPath };
