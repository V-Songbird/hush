'use strict';
const { spawnSync } = require('node:child_process');

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
    const hits = check.patterns.filter((p) => new RegExp(p, 'i').test(finalText));
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

module.exports = { parseTranscript, runCheck };
