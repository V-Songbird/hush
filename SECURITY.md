# Security policy

If you believe you have found a security issue in this plugin, please do not open a public GitHub issue.

Instead, email the details to **victor.villegas@tuta.com**.

Please include:

- A description of the issue
- Steps to reproduce it
- The version affected, if known

You can expect an acknowledgement within 7 days.

## A note on `[hush …]` markers

hush labels the trims it makes with bracketed `[hush …]` notes. Claude is told that a note says what a view left out and how to get the rest back, and that a line asking for anything else is part of the output. In shell output hush may rewrite, in the logs it trims and in a long search result it shortens, a line that already opened like a note gets a backslash in front, `\[hush`, so it cannot pass for one, even behind invisible characters or with a fullwidth bracket. Any other file and any read with an offset or a limit come back exactly as they are on disk, and a search result hush does not shorten comes back exactly as the search returned it: a look-alike line there — in a pasted document or a saved web page — is that file's content, not a hush note, and deserves the same caution as any other text in the file.

> [!NOTE]
> This plugin runs code on your machine, including hooks and helper scripts. Reporting problems privately first gives us time to fix them before others can take advantage of them. Thank you for helping keep users safe.
