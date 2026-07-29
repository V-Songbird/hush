'use strict';
// Retained run records: sanitized before they touch disk, written once, and
// hashed so a later edit is detectable.
//
// `results/` stays local and gitignored — that is the raw output, full of your
// paths and your machine's name. `records/` is the auditable copy: the same
// numbers with everything machine-specific scrubbed out, safe to publish and
// safe to check into a repo, and the only input the claim generator accepts.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// --- sanitizing -------------------------------------------------------------

// Keys whose *value* is never worth keeping, whatever it looks like.
const DROP_KEYS = /^(env|environment|apiKey|api_key|token|secret|password|authorization|cwd|workDir|homedir)$/i;

// Ordered: the specific shapes run before the catch-all token rule, so a
// recognisable secret is labelled as one rather than swallowed generically.
const SECRET_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '<redacted-key>'],
  [/\b(sk-ant-|sk-|ghp_|gho_|ghu_|ghs_|github_pat_|xox[baprs]-|AKIA|ASIA|AIza|glpat-)[A-Za-z0-9_\-]{8,}/g, '<redacted-secret>'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]{12,}/gi, '<redacted-secret>'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>'],
];

// Absolute paths, both platforms, plus UNC shares.
//
// `C:\Program Files\My App\out.log` and `C:\Users\John Smith\...` are ordinary
// Windows paths, and a rule that stopped at the first space left the surname
// and the whole directory tail in a publishable record. So the tail below has
// two ways to swallow a space, and neither can match a space the other can:
//
//   mid-path  — more non-space characters and then another separator, so
//               `My App\out.log` stays inside the path;
//   end-path  — no separator left, but the segment being built carries no file
//               extension and the next word opens with a capital or a caseless
//               letter, which is how a directory is named (`C:\Users\John
//               Smith`, `\\FILESRV\Build Output`, `...\My Documents`). The
//               class is Unicode, not ASCII: `C:\Users\Ana Álvarez`,
//               `C:\Users\Иван Петров` and `C:\Users\山田 太郎` are ordinary
//               profile paths, and CJK has no case at all, hence `\p{Lo}`.
//
// Prose after a path is lower-case, so `C:\tmp\a.log fine` and `C:\tmp then
// run the build` still stop at the path. A rule that ate the rest of the
// sentence would be a different bug, and the cases below pin both ends.
//
// razor: over-redaction here is unbounded, not one word — the end-path branch
// chains through title case and through caps, so `cd C:\tmp Then Run The Build
// And Deploy It now` and `cd C:\tmp THEN RUN` both collapse to `<path>`. Worse
// than the lost bytes: two paths in one phrase merge into a single `<path>`
// (`compare C:\old New C:\new now` -> `compare <path> now`), so the record no
// longer shows there were two. Under-redaction survives in the other
// direction — a lower-case or post-extension final segment still leaks
// (`C:\Users\john smith`, `C:\Users\john.doe Smith`, `C:\Users\J. Smith` ->
// `<path> Smith`, `C:\v1.0 Release Notes` -> `<path> Release Notes`). Deciding
// any of these needs the filesystem, and a record is routinely sanitized on a
// machine that never had those paths; the upgrade path is to pass the run's
// own known roots in as literals to escape and strip.
const pathTail = (stop, rep) => {
  const c = `[^\\s${stop}]`;
  return `(?:${c}`
    + `|[ \\t]+(?=${c}*[\\\\/])`
    + `|(?<![.][^\\\\/]{0,64})[ \\t]+(?!${c}*[\\\\/])(?=[\\p{Lu}\\p{Lt}\\p{Lo}]))${rep}`;
};
const PATH_RULES = [
  [new RegExp(`\\\\\\\\[A-Za-z0-9._-]+\\\\${pathTail(`"'|<>`, '+')}`, 'gu'), '<path>'],
  [new RegExp(`\\b[A-Za-z]:[\\\\/]${pathTail(`"'|<>,;)`, '*')}`, 'gu'), '<path>'],
  [new RegExp(`(^|[\\s"'(=[])\\/(?:Users|home|root|tmp|var|mnt|opt|usr|private|etc|Volumes)`
    + `\\/${pathTail(`"'|<>,;)\\]`, '*')}`, 'gu'), '$1<path>'],
];

// Anything long and unbroken enough to be a credential. Deliberately blunt:
// a false redaction inside a benchmark record costs nothing, a leaked key does.
const TOKEN_RULE = [/\b[A-Za-z0-9_\-]{40,}\b/g, '<redacted-secret>'];

// KEY=value for shouty env-style names — the value goes, the name stays so the
// record still shows which knob was set.
const ENV_RULE = [/\b([A-Z][A-Z0-9_]{2,})=(?!<redacted)[^\s,;'"]+/g, '$1=<redacted-env>'];

/** Machine identity to scrub: whoever ran it, and wherever they ran it. */
function localIdentity() {
  let username = '';
  try { username = os.userInfo().username || ''; } catch { /* no passwd entry */ }
  const host = os.hostname() || '';
  return { username, hosts: [host, host.split('.')[0]].filter((h) => h.length > 2) };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sanitizeText(text, identity = localIdentity()) {
  let s = String(text);
  for (const [re, to] of SECRET_RULES) s = s.replace(re, to);
  for (const [re, to] of PATH_RULES) s = s.replace(re, to);
  s = s.replace(ENV_RULE[0], ENV_RULE[1]);
  s = s.replace(TOKEN_RULE[0], TOKEN_RULE[1]);
  if (identity.username && identity.username.length > 2) {
    s = s.replace(new RegExp(escapeRe(identity.username), 'gi'), '<user>');
  }
  for (const h of identity.hosts) s = s.replace(new RegExp(escapeRe(h), 'gi'), '<host>');
  return s;
}

/** Deep copy with every string sanitized and every dropped key blanked. */
function sanitizeRecord(value, identity = localIdentity()) {
  if (typeof value === 'string') return sanitizeText(value, identity);
  if (Array.isArray(value)) return value.map((v) => sanitizeRecord(v, identity));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = DROP_KEYS.test(k) ? '<redacted>' : sanitizeRecord(v, identity);
    }
    return out;
  }
  return value;
}

// --- hashing and write-once -------------------------------------------------

/**
 * Key-order-independent JSON, so the hash is over content, not formatting.
 *
 * `undefined` has to be handled exactly the way JSON.stringify handles it, or
 * a record hashes one way going in and a different way coming back out, and
 * then never verifies again: an undefined-valued *key* is dropped entirely,
 * an undefined (or missing) *array element* becomes null.
 */
function canonical(value) {
  if (Array.isArray(value)) {
    return `[${Array.from(value, (v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

const HASH_FIELD = 'contentSha256';

function hashRecord(record) {
  const { [HASH_FIELD]: _ignored, ...rest } = record;
  return crypto.createHash('sha256').update(canonical(rest)).digest('hex');
}

/** True when the record still hashes to the value it was written with. */
function verifyRecord(record) {
  return typeof record[HASH_FIELD] === 'string' && record[HASH_FIELD] === hashRecord(record);
}

/**
 * Sanitize, hash, write once. A second write to the same name throws instead
 * of replacing — a retained record is evidence, and evidence that can be
 * quietly rewritten is not evidence. Delete the file by hand if you really
 * mean to discard a run.
 */
function writeRecord(dir, name, record, identity = localIdentity()) {
  fs.mkdirSync(dir, { recursive: true });
  const clean = sanitizeRecord(record, identity);
  clean[HASH_FIELD] = hashRecord(clean);
  const file = path.join(dir, `${name}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(clean, null, 2) + '\n', { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`record already exists, refusing to overwrite: ${file}`);
    throw err;
  }
  // Read-only on both platforms; a deliberate chmod/attrib still lets you
  // delete it, which is the point — no overwrite by accident, no lock-in.
  try { fs.chmodSync(file, 0o444); } catch { /* filesystem without modes */ }
  return file;
}

/** Every *.json under dir, hash-verified. `batch.json` files come back separately. */
function readRecords(dir) {
  const runs = [];
  const batches = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!e.name.endsWith('.json')) continue;
      const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!verifyRecord(obj)) throw new Error(`record hash mismatch (edited after it was written?): ${f}`);
      (e.name === 'batch.json' ? batches : runs).push(obj);
    }
  };
  walk(dir);
  return { runs, batches };
}

module.exports = {
  sanitizeText, sanitizeRecord, canonical, hashRecord, verifyRecord,
  writeRecord, readRecords, localIdentity, HASH_FIELD,
};
