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
//   node style-settings.js tally         the mod's count of checked messages, one JSON line
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

// The mod's silent count of final messages, kept beside the settings file: numbers, days and
// the key of the settings it was kept under. These copy hooks/lint.ts, which a CommonJS script
// cannot import; tests/desktop_mod.test.js keeps them equal.
const TALLY_RULES = [
  "result first",
  "rules where set",
  "next step where set",
  "sentences within limit",
  "blocks within limit",
  "no raw html",
  "markdown forms as set",
];
const TALLY_KNOBS = ["next", "rules", "markdown", "sentences", "emoji", "headers"];
const TALLY_FIELDS = ["last", "messages", "met", "misses", "settings", "since"];
const TALLY_MAX = 65536;
const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

const settingsKey = (settings) => TALLY_KNOBS.map((k) => settings[k]).join("-");

// The settings file and the count beside it, named exactly as lint.ts countFiles names them,
// and only for an absolute path to a file, so a relative HUSH_CONFIG_FILE reads no tally in a
// project, and one that ends in a separator reads none in the folder above it.
function countFiles(named, home, isWindows) {
  const sep = isWindows ? "\\" : "/";
  const config = named || (home ? `${home.replace(isWindows ? /[\\/]+$/ : /\/+$/, "")}${sep}.claude${sep}hush${sep}config.json` : "");
  const isAbsolute = isWindows ? /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]+[^\\/])/ : /^\//;
  if (!isAbsolute.test(config) || (isWindows ? /[\\/]$/ : /\/$/).test(config)) return undefined;
  const cut = isWindows ? Math.max(config.lastIndexOf("/"), config.lastIndexOf("\\")) : config.lastIndexOf("/");
  return { config, tally: `${config.slice(0, cut + 1)}tally.json` };
}

// The home os.homedir() reads first: USERPROFILE on Windows, HOME elsewhere.
function tallyPath(env = process.env, isWindows = process.platform === "win32") {
  return countFiles(env.HUSH_CONFIG_FILE, isWindows ? env.USERPROFILE : env.HOME, isWindows)?.tally;
}

// Everything printed is checked first: counts, known rule names, days, and a settings key for
// the current settings. No file, or one that is not such a count, is no count: { messages: 0 }.
// So is HUSH_DISABLE=1, under which the mod counts nothing.
function readTally() {
  const none = { messages: 0 };
  const file = tallyPath();
  if (isOn("HUSH_DISABLE") || file === undefined) return none;
  let t;
  try {
    const text = fs.readFileSync(file, "utf8");
    if (text.length > TALLY_MAX) return none;
    t = JSON.parse(text);
  } catch {
    return none;
  }
  const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
  const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (
    !isObject(t) ||
    Object.keys(t).some((k) => !TALLY_FIELDS.includes(k)) ||
    t.settings !== settingsKey(load()) ||
    !isCount(t.messages) ||
    t.messages === 0 ||
    !isCount(t.met) ||
    t.met > t.messages ||
    typeof t.since !== "string" ||
    !DAY.test(t.since) ||
    typeof t.last !== "string" ||
    !DAY.test(t.last) ||
    t.since > t.last ||
    !isObject(t.misses) ||
    Object.entries(t.misses).some(([rule, n]) => !TALLY_RULES.includes(rule) || !isCount(n) || n > t.messages)
  )
    return none;
  return { messages: t.messages, met: t.met, misses: { ...t.misses }, since: t.since, last: t.last };
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

function save(settings) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
}

function hook() {
  try {
    if (isOn("HUSH_DISABLE")) return;
    readInput(); // the payload carries nothing these settings need
    const text = compose(load());
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
  if (cmd === "tally") {
    process.stdout.write(JSON.stringify(readTally()) + "\n");
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
  process.stderr.write("usage: style-settings.js [show | tally | presets | set [preset=name] knob=value ... | reset]\n");
  return 2;
}

if (require.main === module) {
  if (process.argv.length > 2) process.exitCode = cli(process.argv.slice(2));
  else hook();
}

module.exports = {
  KNOBS,
  DEFAULTS,
  PRESETS,
  HEADER,
  TALLY_RULES,
  TALLY_KNOBS,
  TALLY_FIELDS,
  TALLY_MAX,
  load,
  parse,
  compose,
  configPath,
  countFiles,
  settingsKey,
  tallyPath,
  readTally,
};
