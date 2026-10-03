# voice-ux — brief

## In the user's words (2026-10-03)

> Our voice skill has a few annoyances we need to address:
> - It doesn't speak naturally. It lays out options, then says "Say your choice". It can just as the question humanly.
> - Sometimes Claude presents options, so it reads the options, then it summarizes by itself - again, saying "your options are..."
> - The CLI doesn't reflect my transcribed response in realtime so I have no way of reacting
> - I have no way of replaying what it says
> - I have no way of canceling it mid-speech

## Root causes (read from the code, 2026-10-03)

1. **Robotic phrasing** — the utterance is a fixed template stamped over structured
   data, in two places: `mcp/ask-server.mjs` (`"Claude asks: Q. Your options are:
   Option one: X. … Say your choice."`) and `hooks/extract-spoken.mjs` (same shape).
   Nobody *phrases* the question; a template renders it.
2. **Double options** — two authors of one utterance. Claude already names the
   choices in the `question` it passes to `ask_by_voice` (it is told to phrase it
   "for the ear"), and the tool then appends its own "Your options are…".
3. **No live transcript** — `listen.sh` records a blind fixed 10 s window, then
   transcribes once; `ask_by_voice` runs it with `spawnSync`, so the server can
   emit nothing while it waits. The user sees nothing until the tool returns.
4. **No replay** — nothing remembers what was last said.
5. **No cancel** — `ask_by_voice` speaks with `spawnSync`, which blocks the
   server's event loop: a cancel request can't even be read until the speech ends
   (and is ignored anyway). Detached
   hook speech can only be stopped by the *next* utterance.
