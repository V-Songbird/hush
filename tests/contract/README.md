# Contract fixtures and goldens

One pair of files per scenario, driven by [`../contract.test.js`](../contract.test.js):

- `fixtures/<name>.json` — the payload piped to the hook's stdin.
- `golden/<name>.txt` — the exact bytes the hook must write to stdout. An
  empty file means the hook must emit nothing at all.

The point is the wire, not the logic. Every other suite parses hush's output
and asserts on a field, which cannot see a renamed envelope key, a lost
raw-stdout channel, a stray newline, or a provenance note that started
repeating. This one compares bytes.

Each scenario also carries `must` / `mustNot` literals in the test file. A
golden regenerated from the code proves stability, never meaning — those
literals are what the scenario is actually for.

Regenerate after a deliberate wording change:

```
node tests/contract.test.js --update
```

Then read the diff. A golden that moved without a reason you can name is the
bug, not the test.

## Substitutions

Bulk does not belong inline in a fixture, so the runner expands a few
generators and nothing else:

| Token | Becomes |
| --- | --- |
| `{{SESSION}}` | the scenario's session id |
| `{{TMP}}` | the scenario's temp root, forward-slashed |
| `{{TRANSCRIPT}}` | the scenario's transcript fixture, when it declares one |
| `{{UNIQUE:n}}` | `n` lines of varying shape — survives template collapse |
| `{{REPEAT:n}}` | `n` lines of one shape — collapsible |
| `{{FAILING:n}}` | `n` lines with error, warning and failure lines seeded in |
| `{{GREP:n}}` | `n` `file:line:text` match lines across twenty files |

Every scenario runs against its own temp root, so a sidecar directory, a
session-note sentinel and a react counter can never leak between scenarios.
That root is spelled back out of the emitted bytes as `{{TMP}}`, which is the
only normalization applied — it lets a golden name a parked file without
pinning the machine it was generated on.

## Sizing a fixture

hush only emits when it actually shrinks something, so a fixture below a
threshold produces an empty golden and pins nothing. The thresholds, from
`hooks/compress-tool-output.js`:

| Path | Needs |
| --- | --- |
| Passing shell/Read cap | more than `CAP_PASS` (60) lines after collapse |
| Failing shell cap | more than `CAP_FAIL` (250) lines — a 120-line failure is not cut |
| Shell sidecar | between `SIDECAR_MIN_CHARS` (15,000) and `SIDECAR_SHELL_MAX` (28,000) chars |

Above `SIDECAR_SHELL_MAX` a *passing* shell output deliberately steps aside —
the host may already have truncated it — so an oversized fixture measures the
guard, not the sidecar. Content also has to survive template collapse to reach
the sidecar at all: same-shape lines collapse first and never park.

## Porting

These goldens are the acceptance criteria for a port. A second host emits
different shapes for the same decisions, so a port keeps these fixtures,
writes its own goldens, and passes them. `hooks/lib/harness.js` is the file a
port swaps; this directory is how it proves the swap was clean.
