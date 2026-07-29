'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { debugManifestPath } = require('../../hooks/compress-tool-output');

// Parse a stream-json transcript (one JSON event per line) into flat metrics.
function parseTranscript(jsonl) {
  const events = [];
  for (const line of jsonl.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { /* partial line on kill */ }
  }

  const m = {
    outputStyle: null,
    modelUsed: null,
    sessionId: null,
    assistantTexts: [],        // one entry per assistant message that had text
    toolCalls: 0,
    toolResultChars: 0,
    contextTraffic: 0,         // Σ per-call input + cache_read + cache_creation
    apiCalls: 0,
    finalText: '',
    usage: null,
    costUsd: null,
    numTurns: null,
    durationMs: null,
    resultSubtype: null,
  };

  const usageByMsgId = new Map(); // dedupe: one assistant message can span events
  const textByMsgId = new Map();

  for (const ev of events) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      m.outputStyle = ev.output_style || null;
      m.modelUsed = ev.model || null;
      m.sessionId = ev.session_id || null;
    } else if (ev.type === 'assistant' && ev.message) {
      const id = ev.message.id || `anon-${usageByMsgId.size}`;
      if (ev.message.usage) usageByMsgId.set(id, ev.message.usage);
      const texts = (ev.message.content || [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text);
      if (texts.length) {
        textByMsgId.set(id, (textByMsgId.get(id) || '') + texts.join('\n'));
      }
      m.toolCalls += (ev.message.content || []).filter((c) => c.type === 'tool_use').length;
    } else if (ev.type === 'user' && ev.message) {
      const content = ev.message.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type !== 'tool_result') continue;
          if (typeof c.content === 'string') m.toolResultChars += c.content.length;
          else if (Array.isArray(c.content)) {
            for (const part of c.content) {
              if (part.type === 'text' && part.text) m.toolResultChars += part.text.length;
            }
          }
        }
      }
    } else if (ev.type === 'result') {
      m.usage = ev.usage || null;
      m.costUsd = ev.total_cost_usd ?? null;
      m.numTurns = ev.num_turns ?? null;
      m.durationMs = ev.duration_ms ?? null;
      m.resultSubtype = ev.subtype || null;
      m.finalText = typeof ev.result === 'string' ? ev.result : '';
    }
  }

  for (const u of usageByMsgId.values()) {
    m.apiCalls++;
    m.contextTraffic +=
      (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  }
  m.assistantTexts = [...textByMsgId.values()];

  const words = (s) => (s.match(/\S+/g) || []).length;
  const allWords = m.assistantTexts.reduce((n, t) => n + words(t), 0);
  m.finalWords = words(m.finalText || m.assistantTexts[m.assistantTexts.length - 1] || '');
  m.narrationWords = Math.max(0, allWords - m.finalWords);
  return m;
}

// Ground-truth checkers, declarative via tasks.json `check`.
function runCheck(check, finalText, workDir) {
  if (check.type === 'keywords') {
    // A session may legitimately deliver the asked-for code as a file and only
    // summarize in chat. When the check opts in via orFiles (an extension,
    // e.g. ".py"), top-level workdir files with that extension join the
    // scored corpus. Opt-in only: fixture tasks would otherwise self-match
    // their own inputs. razor: top-level scan only — nest-happy sessions can
    // move to a recursive walk if one ever appears.
    let corpus = finalText;
    if (check.orFiles && workDir && fs.existsSync(workDir)) {
      for (const f of fs.readdirSync(workDir)) {
        if (f.endsWith(check.orFiles)) {
          try { corpus += '\n' + fs.readFileSync(path.join(workDir, f), 'utf8'); } catch {}
        }
      }
    }
    const hits = check.patterns.filter((p) => new RegExp(p, 'i').test(corpus));
    return {
      pass: hits.length >= check.require,
      score: hits.length / check.patterns.length,
      detail: `${hits.length}/${check.patterns.length} rubric hits (need ${check.require})`,
    };
  }
  if (check.type === 'tests') {
    const [cmd, ...args] = check.cmd.split(' ');
    const r = spawnSync(cmd, args, { cwd: workDir, shell: true, encoding: 'utf8', timeout: 60000 });
    return {
      pass: r.status === 0,
      score: r.status === 0 ? 1 : 0,
      detail: r.status === 0 ? 'tests pass' : `tests exit ${r.status}`,
    };
  }
  throw new Error(`unknown check type ${check.type}`);
}

// Reject a run that cannot honestly be a data point, before it reaches the
// averages. Two shapes, both of which arrive looking like success:
//
//   * A rate-limited call. The CLI reports subtype "success", exits 0, and
//     hands back "You've hit your session limit ..." AS the model's answer, at
//     cost 0. Left alone it lands in the averages as a very terse reply and
//     silently poisons the batch.
//   * Any call that billed nothing. Every real headless call costs something;
//     a zero or missing cost means the call did not happen the way we think it
//     did, so its token and word counts do not describe a session either.
//
// Throwing records the run as an error, which keeps it out of every report and
// lets --resume re-run it.
function assertUsableRun(parsed) {
  for (const p of parsed) {
    if (/you\s*['’]?ve hit your (session|usage|weekly) limit/i.test(p.finalText || '')) {
      throw new Error(`rate limited: ${String(p.finalText).trim().slice(0, 120)}`);
    }
    if (!(p.costUsd > 0)) {
      throw new Error(`zero-cost call (cost=${p.costUsd}, subtype=${p.resultSubtype}) — not a usable data point`);
    }
  }
}

// Probe 9 Spec 1 ingestion: read hush's HUSH_DEBUG=1 per-decision manifest
// for a session, if one was written. Fail-soft by design — a run with the
// debug flag off, an arm without hush's hooks loaded, or a baseline run all
// leave no file, and that's not an error, just nothing to report.
function readDebugManifest(sessionId) {
  if (!sessionId) return null;
  const file = debugManifestPath(sessionId);
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return null;
  }
  if (!lines.length) return null;

  const byAction = {};
  let bytesIn = 0, bytesOut = 0;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    byAction[entry.action] = (byAction[entry.action] || 0) + 1;
    bytesIn += entry.bytesIn || 0;
    bytesOut += entry.bytesOut || 0;
  }
  return { entries: lines.length, byAction, bytesIn, bytesOut };
}

module.exports = { parseTranscript, runCheck, readDebugManifest, assertUsableRun };
