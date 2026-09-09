# Coordinated README pull requests

Common README changes belong in both platform editions. Validate their working
copies with `check-readme-parity.js --pair` before preparing PRs. Native-only
changes can continue comparing against the integrated opposite branch.

For a common change, prepare one PR targeting Claude and one targeting Codex in
the same plugin repository. After both candidate commits exist, put this exact
line in each PR description, naming the other PR and its full current head SHA:

```text
Foundry-README-Peer: #<other-PR-number>@<full-40-character-SHA>
```

Replace both placeholders. Each declaration must be reciprocal. The workflow
reads descriptions as data and fetches the declared peer's PR ref; it does not
execute the description or run code from that peer. It verifies the API head,
fetched commit, destination edition, repository and common README contract.
A peer closed without merging fails. A merged peer can remain the counterpart
while the second PR completes.

Run the README contract check on both PRs after both descriptions are current.
Description edits trigger this workflow; if the first run started before the
reciprocal declaration existed, rerun that check. Changing either commit requires
reviewing and updating the opposite description's SHA and rerunning both checks.
Do not disable parity to get the first PR through.

Candidate-pair success permits reviewing and integrating the pair through the
normal protected PR process; it does not establish that both branches are already
integrated. Push checks and Foundry's aggregate check compare the integrated
Claude/Codex tips. After both merges, run the workflow again on each edition
(manual dispatch is supported) and require the integrated pair to pass before
publishing selectors or catalog pins. A failed intermediate push comparison must
not be described as final parity.

This mechanism checks documentation coordination, not measurement truth or
runtime equivalence. Preserve the source-review requirements and all other
branch checks. It does not authorize PR creation, merging or publication.
