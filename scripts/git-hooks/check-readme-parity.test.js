"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {parseReadme,compare}=require("./check-readme-parity.js");
function sample(edition){
 const block=(key,body="Native detail")=>`<!-- foundry:platform ${key} -->\n${body}\n<!-- /foundry:platform ${key} -->`;
 return `<!-- foundry:edition ${edition} -->\n# Example\n${block('identity',edition)}\n## What is this?\nShared purpose.\n## Why you'd want it\nShared benefit.\n## How it works\nShared contract.\n## Install\n${block('install')}\n## What you can do\nShared outcomes.\n${block('commands')}\n## Good to know\n${block('compatibility')}\n## The numbers\n${block('benchmarks',`<!-- foundry:evidence {"platform":"${edition}","status":"measured","models":["Model ${edition}"],"source":"report.md","date":"2026-09-08"} -->\n| Model | Setup | Correct |\n| --- | --- | --- |\n| Model ${edition} | Plugin | 9/10 |`)}\n## Going deeper\n${block('links')}\n## License\nMIT\n`;
}
test("native differences pass when shared narrative and metrics agree",()=>assert.ok(compare(sample('Claude'),sample('Codex')).commonBytes>0));
test("shared product drift is rejected",()=>assert.throws(()=>compare(sample('Claude'),sample('Codex').replace('Shared purpose.','Different purpose.')),/Shared README/));
test("host-specific measurements cannot be silently relabeled",()=>assert.throws(()=>parseReadme(sample('Codex').replace('"platform":"Codex"','"platform":"Claude"')),/different platform/));
test("benchmark rows must identify a measured model",()=>assert.throws(()=>parseReadme(sample('Codex').replace('| Model Codex | Plugin','| Other model | Plugin')),/undeclared model/));
test("metric differences are rejected even inside the benchmark exception",()=>assert.throws(()=>compare(sample('Claude'),sample('Codex').replace('| Correct |','| Words |')),/columns differ/));
test("unclosed, duplicate, nested and invented exceptions fail",()=>{
 const s=sample('Claude');
 assert.throws(()=>parseReadme(s.replace('<!-- /foundry:platform links -->','')));
 assert.throws(()=>parseReadme(s+'\n<!-- foundry:platform links -->\na\n<!-- /foundry:platform links -->'));
 assert.throws(()=>parseReadme(s.replace('Native detail','<!-- foundry:platform links -->')));
 assert.throws(()=>parseReadme(s.replaceAll('platform install','platform anything')));
});
test("main headings cannot be hidden inside an exception",()=>assert.throws(()=>parseReadme(sample('Codex').replace('Native detail','## Hidden product section')),/outside/));
test("missing or malformed provenance fails for measured claims",()=>{
 assert.throws(()=>parseReadme(sample('Codex').replace('"source":"report.md",','')),/source/);
 assert.throws(()=>parseReadme(sample('Codex').replace('"source":"report.md"','"source":7')),/source/);
});
test("review dates cannot masquerade as source dates",()=>{
 assert.throws(()=>parseReadme(sample('Codex').replace('"date":"2026-09-08"','"date":"reviewed today"')),/source date/);
 assert.equal(parseReadme(sample('Codex').replace('"date":"2026-09-08"','"date":"unknown","dateReason":"Retained source omits the run date"')).evidence.date,'unknown');
});
test("pending measurements preserve the table without made-up numbers",()=>{
 const pending=sample('Codex').replace('"status":"measured","models":["Model Codex"],"source":"report.md","date":"2026-09-08"','"status":"pending","reason":"No paired run"').replace('9/10','Not measured');
 assert.equal(parseReadme(pending).evidence.status,'pending');
 assert.throws(()=>parseReadme(pending.replace('Not measured','0/10')),/cannot contain/);
});
test("an edition must match its CI destination",()=>assert.throws(()=>parseReadme(sample('Claude'),'Codex'),/Expected/));
test("line-ending differences are harmless but same-edition comparisons fail",()=>{
 assert.ok(compare(sample('Claude').replaceAll('\n','\r\n'),sample('Codex')));
 assert.throws(()=>compare(sample('Codex'),sample('Codex')),/one Claude/);
});

test("Git-pair mode compares the named committed branches, not an unrelated working edit",()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'readme-pair-'));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_')));
 const git=(...args)=>cp.execFileSync('git',['-C',root,...args],{env,stdio:'pipe'});
 const commit=()=>{git('add','README.md');git('-c','core.hooksPath=','-c','commit.gpgsign=false','commit','-m','fixture');};
 const run=()=>cp.spawnSync(process.execPath,[require.resolve('./check-readme-parity.js'),'--git-pair',root,'refs/heads/Claude','refs/heads/Codex'],{env,encoding:'utf8'});
 try{
  git('init','-b','Claude');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  fs.writeFileSync(path.join(root,'README.md'),sample('Claude'));commit();
  git('switch','-c','Codex');fs.writeFileSync(path.join(root,'README.md'),sample('Codex'));commit();
  assert.equal(run().status,0);
  fs.writeFileSync(path.join(root,'README.md'),sample('Codex').replace('Shared purpose.','Unrelated drift.'));
  assert.equal(run().status,0);
  commit();const failure=run();assert.equal(failure.status,1);assert.match(failure.stderr,/Shared README content differs/);
 }finally{
  const temp=fs.realpathSync(os.tmpdir());
  if(!path.resolve(root).startsWith(temp+path.sep)||!path.basename(root).startsWith('readme-pair-'))throw Error('Unsafe fixture cleanup');
  fs.rmSync(root,{recursive:true,force:true});
 }
});
