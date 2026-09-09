"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process");
const { declaration, validatePair, run } = require("./check-readme-candidate");
const sha = letter => letter.repeat(40);
function pair() {
  const make = (number, platform, head, peerNumber, peerHead) => ({ number, state: "open",
    body: `Foundry-README-Peer: #${peerNumber}@${peerHead}`,
    base: { ref: platform, repo: { full_name: "owner/plugin" } }, head: { sha: head } });
  return [make(1, "Claude", sha("a"), 2, sha("b")), make(2, "Codex", sha("b"), 1, sha("a"))];
}
test("pair declarations require a single exact PR and full SHA", () => {
  assert.equal(declaration("Ordinary PR"), null);
  assert.deepEqual(declaration(`Foundry-README-Peer: #2@${sha("a")}`), { number: 2, sha: sha("a") });
  for (const body of ["Foundry-README-Peer: #2@abc", `Foundry-README-Peer: #2@${sha("a")}\nFoundry-README-Peer: #3@${sha("b")}`,
    "Foundry-README-Peer: $(unsafe)"]) assert.throws(() => declaration(body));
});
test("pairing rejects wrong editions, repositories, stale heads and missing reciprocal acknowledgement", () => {
  const [a, b] = pair();
  assert.equal(validatePair(a, b, "owner/plugin").number, 2);
  for (const change of [p => p.base.ref = "Claude", p => p.base.repo.full_name = "other/plugin",
    p => p.head.sha = sha("c"), p => p.body = "", p => p.state = "closed"]) {
    const peer = structuredClone(b); change(peer);
    assert.throws(() => validatePair(a, peer, "owner/plugin"));
  }
  assert.equal(validatePair(a, { ...b, state: "closed", merged: true }, "owner/plugin").number, 2);
});

test("a peer ref that moves between API inspection and fetch is rejected", async () => {
  const [a, b] = pair();
  await assert.rejects(run({ event: { pull_request: a }, eventName: "pull_request", repository: "owner/plugin",
    api: async number => number === 1 ? a : b,
    git: args => args[0] === "fetch" ? "" : args[1] === "HEAD" ? a.head.sha : sha("c"),
  }), /Fetched peer changed/);
});

function sample(edition, story = "Shared purpose.") {
  const block = (name, text = edition) => `<!-- foundry:platform ${name} -->\n${text}\n<!-- /foundry:platform ${name} -->`;
  return `<!-- foundry:edition ${edition} -->\n# Example\n${block("identity")}\n## What is this?\n${story}\n## Why you'd want it\nShared benefit.\n## How it works\nShared mechanism.\n## Install\n${block("install")}\n## What you can do\n${block("commands")}\n## Good to know\n${block("compatibility")}\n## The numbers\n${block("benchmarks", `<!-- foundry:evidence {"platform":"${edition}","status":"pending","reason":"No measurement"} -->\n| Model | Setup | Correct |\n| --- | --- | --- |\n| Unmeasured | Planned | Not measured |`)}\n## Going deeper\n${block("links")}\n## License\nMIT\n`;
}
test("two unmerged candidates pass against each other while both fail against the old peer branch", async () => {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "foundry-candidate-pair-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const git = args => cp.execFileSync("git", args, { cwd: temp, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git(["init", "-q"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    git(["config", "commit.gpgsign", "false"]); git(["remote", "add", "origin", temp]);
    const commit = text => { fs.writeFileSync(path.join(temp, "README.md"), text); git(["add", "README.md"]); git(["commit", "-qm", "fixture"]); return git(["rev-parse", "HEAD"]).trim(); };
    const oldClaude = commit(sample("Claude")); git(["branch", "Claude", oldClaude]);
    const oldCodex = commit(sample("Codex")); git(["branch", "Codex", oldCodex]);
    const newClaude = commit(sample("Claude", "Updated shared purpose.")); git(["update-ref", "refs/pull/1/head", newClaude]);
    const newCodex = commit(sample("Codex", "Updated shared purpose.")); git(["update-ref", "refs/pull/2/head", newCodex]);
    const [a, b] = pair(); a.head.sha = newClaude; b.head.sha = newCodex;
    a.body = `Foundry-README-Peer: #2@${newCodex}`; b.body = `Foundry-README-Peer: #1@${newClaude}`;
    for (const current of [a, b]) {
      git(["checkout", "--detach", "-q", current.head.sha]);
      const options = { event: { pull_request: current }, eventName: "pull_request", repository: "owner/plugin", git,
        api: async number => number === 1 ? a : b };
      assert.equal((await run(options)).mode, "candidate-pair");
      await assert.rejects(run({ ...options, api: async number => ({ ...(number === 1 ? a : b), body: "" }) }), /Shared README content/);
    }
    git(["update-ref", "refs/heads/Claude", newClaude]); git(["update-ref", "refs/heads/Codex", newCodex]);
    assert.equal((await run({ event: {}, eventName: "push", refName: "Codex", repository: "owner/plugin", git })).mode, "integrated-peer");
    const stale = structuredClone(a); stale.head.sha = oldClaude;
    await assert.rejects(run({ event: { pull_request: a }, eventName: "pull_request", repository: "owner/plugin", git, api: async () => stale }), /Current PR head changed/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
