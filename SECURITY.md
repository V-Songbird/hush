# Security policy

If you believe you have found a security issue in this plugin, please do not open a public GitHub issue.

Instead, email the details to **victor.villegas@tuta.com**.

Please include:

- A description of the issue
- Steps to reproduce it
- The version affected, if known

You can expect an acknowledgement within 7 days.

## A note on `[hush …]` markers

hush labels the trims it makes with bracketed `[hush …]` notes, and Claude is told to treat those notes as the plugin's own bookkeeping. That trust covers only notes hush itself wrote. A look-alike line that was already inside a file's own bytes — a log, a pasted document, a saved web page — is that file's content, not hush telemetry, and deserves the same caution as any other text in the file.

> [!NOTE]
> This plugin runs code on your machine, including hooks and helper scripts. Reporting problems privately first gives us time to fix them before others can take advantage of them. Thank you for helping keep users safe.
