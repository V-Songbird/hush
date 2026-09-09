#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { parseReadme, compare } = require("./check-readme-parity");

function declaration(body) {
  const lines = String(body || "").split(/\r?\n/).filter(line => /^Foundry-README-Peer:/.test(line));
  if (!lines.length) return null;
  if (lines.length !== 1) throw Error("Declare exactly one Foundry-README-Peer line.");
  const match = lines[0].match(/^Foundry-README-Peer: #([1-9][0-9]*)@([0-9a-f]{40})$/);
  if (!match) throw Error("Use Foundry-README-Peer: #<PR-number>@<full-40-character-SHA>.");
  return { number: Number(match[1]), sha: match[2] };
}

function validatePair(current, peer, repository) {
  const wanted = declaration(current.body);
  if (!wanted || wanted.number === current.number || peer.number !== wanted.number) throw Error("Invalid peer PR.");
  const opposite = current.base.ref === "Claude" ? "Codex" : current.base.ref === "Codex" ? "Claude" : null;
  if (!opposite || current.base.repo.full_name !== repository || peer.base.repo.full_name !== repository || peer.base.ref !== opposite)
    throw Error("Peer PR must target the opposite edition in the same repository.");
  if (peer.state !== "open" && !peer.merged) throw Error("Peer PR was closed without merging.");
  if (peer.head.sha !== wanted.sha) throw Error("Peer head changed; review and update the declared SHA.");
  const reciprocal = declaration(peer.body);
  if (!reciprocal || reciprocal.number !== current.number || reciprocal.sha !== current.head.sha)
    throw Error("Peer PR must reciprocally declare this PR and its exact current SHA.");
  return wanted;
}

async function run({ event, eventName, refName, repository, api, git }) {
  const head = git(["rev-parse", "HEAD"]).trim();
  let platform = refName, peerRef, expectedSha;
  if (eventName === "pull_request") {
    const current = await api(event.pull_request.number);
    if (current.head.sha !== head || current.head.sha !== event.pull_request.head.sha)
      throw Error("Current PR head changed; rerun against its latest revision.");
    platform = current.base.ref;
    const wanted = declaration(current.body);
    if (wanted) {
      const peer = await api(wanted.number);
      validatePair(current, peer, repository);
      peerRef = `refs/pull/${wanted.number}/head`;
      expectedSha = wanted.sha;
    }
  }
  if (!["Claude", "Codex"].includes(platform)) throw Error("Expected a Claude or Codex destination.");
  if (!peerRef) peerRef = `refs/heads/${platform === "Claude" ? "Codex" : "Claude"}`;
  git(["fetch", "--no-tags", "origin", peerRef]);
  const peerSha = git(["rev-parse", "FETCH_HEAD"]).trim();
  if (expectedSha && peerSha !== expectedSha) throw Error("Fetched peer changed during validation; rerun after reviewing its SHA.");
  const currentText = git(["show", `${head}:README.md`]);
  const peerText = git(["show", `${peerSha}:README.md`]);
  parseReadme(currentText, platform);
  parseReadme(peerText, platform === "Claude" ? "Codex" : "Claude");
  compare(currentText, peerText);
  return { platform, head, peer: peerSha, source: peerRef, mode: expectedSha ? "candidate-pair" : "integrated-peer" };
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "")) throw Error("GITHUB_REPOSITORY is required.");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const git = args => execFileSync("git", args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
  const api = async number => {
    const base = process.env.GITHUB_API_URL || "https://api.github.com";
    const response = await fetch(`${base}/repos/${repository}/pulls/${number}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_TOKEN || ""}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error(`Cannot inspect peer coordination: GitHub returned ${response.status}.`);
    return response.json();
  };
  const result = await run({ event: JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    eventName: process.env.GITHUB_EVENT_NAME, refName: process.env.GITHUB_REF_NAME, repository, api, git });
  console.log("README coordination passed: " + JSON.stringify(result));
}

module.exports = { declaration, validatePair, run };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
