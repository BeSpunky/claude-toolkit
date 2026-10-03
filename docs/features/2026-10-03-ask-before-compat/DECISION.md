---
effort: ask-before-compat
summary: Toolkit skills never default to backwards compatibility — when Claude considers a stub, shim, alias or deprecation period, it asks the user whether it is needed
---

# Decision — ask before keeping backwards compatibility

> "improve our toolkit skills so they never leave backwards compatibility as default. If Claude is thinking of backwards compatibility the user should be asked if it's needed."

Trigger: the project-starter → bespunky-house rename shipped a hand-over stub plugin and a `scaffold.sh` shim that were
only mentioned inside a larger proposal, never asked as a question. The user: "I didn't ask you to do that. Remove it completely."
