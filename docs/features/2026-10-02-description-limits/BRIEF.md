# Description limits

The user pasted Claude Desktop's plugin warnings (2026-10-02): every plugin's description is over 500 characters, and 25 skill descriptions are over 1024, some with `<`/`>` — "claude.ai stores its description cut to 1024 characters" / "with angle brackets removed". Claude Code reads the full text, so nothing here noticed.

Goal: every plugin description ≤ 500 (plugin.json and its marketplace entry), every skill description ≤ 1024 with no `<` `>` — rewritten as TRIGGERS (keep what decides when it fires; move the rest into the body, losing nothing) — and a checker (`tools/check-descriptions`, CI + pre-push) so it can't drift back.
