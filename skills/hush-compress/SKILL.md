---
name: hush-compress
description: Compresses a memory file (CLAUDE.md, project notes, preferences) into hush's own dev-shorthand voice to cut input tokens every session it's loaded. Never touches the original file — writes a sibling file for the user to review and swap in manually. A mechanical verifier checks that headings, code blocks, URLs, paths, and inline code all survived.
when_to_use: Trigger when the user wants to shrink a memory/CLAUDE.md file to save input tokens, says "compress this file", "shrink my CLAUDE.md", "compress this memory file", or invokes /hush:hush-compress <path>.
argument-hint: "<path to the file to compress>"
allowed-tools: Read, Write, Bash, PowerShell
---

# hush:hush-compress

Shrinks a memory file's word count using hush's own voice — the same "Word economy" rules the output style already applies to conversation — so every future session that loads this file pays fewer input tokens for it. Never writes to the original.

## 1. Refuse before reading, if the path matches any of

`.env` (or `.env.*`), `.netrc`, `credentials*`, `secrets*`, `passwords*`, `id_rsa`/`id_ed25519` (or `.pub`), `authorized_keys`, `known_hosts`, any `*.pem/*.key/*.p12/*.pfx/*.crt/*.cer/*.jks/*.keystore/*.asc/*.gpg`, or any path containing a `.ssh/`, `.aws/`, `.gnupg/`, or `.kube/` component.

Tell the user why and stop. Do not read the file. These are exactly the kinds of files that must never reach a model call.

## 2. Read the file, refuse if empty

If the file is empty or whitespace-only after reading, say so and stop — nothing to compress.

## 3. Compress the body, not the whole file

If the file starts with YAML frontmatter (`---` ... `---`), leave it completely untouched — copy it verbatim into the output. Compress only the body below it.

Apply hush's own word economy — see `output-styles/hush.md`:
- Say it in the fewest words that stay understandable. Before keeping a sentence, ask: can this lose a word without losing a fact? If yes, cut it.
- Default to fragments, not sentences. Drop articles, hedges, and connective tissue a reader fills in on their own.
- This is dev-shorthand density, not broken grammar: grammar stays correct where it's present, technical terms stay exact, nothing is invented or abbreviated beyond recognition.

Preserve these EXACTLY, byte for byte — never reword, shorten, or paraphrase inside them:
- fenced code blocks and inline code (`` `like this` ``)
- URLs and markdown links
- file paths and shell commands
- technical terms, proper nouns, library/API names
- version numbers, dates, numeric values
- environment variable names (`$HOME`, `NODE_ENV`)
- heading text and heading order

## 4. Write the result to a sibling file — never the original

For `some/path/CLAUDE.md`, write to `some/path/CLAUDE.hush.md`. For any other filename, insert `.hush` before the extension (`notes.md` → `notes.hush.md`). This is the whole safety model: the original's bytes are never touched by this skill, in any step, so there is no path by which running this can damage or delete the source file.

## 5. Verify mechanically

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-compression.js" <original> <compressed>
```

This checks that every heading, code block, URL, path, and inline-code span in the original still appears somewhere in the compressed file. It exits 1 and lists what's missing if not — it doesn't block anything (there's nothing destructive to block), it's evidence for you to look at before reporting back.

If something is flagged missing, look at whether it actually mattered (the checker is deliberately crude and can flag things like a URL fragment as a false "path") — restore anything real that got dropped, by editing the sibling file, before reporting.

## 6. Report

One line: original word count → compressed word count, percent saved, where the sibling file was written. If the verifier flagged anything worth mentioning, say what and whether you fixed it. Tell the user to review the sibling file and manually replace the original (or ask them to rename it) once they're satisfied — this skill never does that replacement itself.
