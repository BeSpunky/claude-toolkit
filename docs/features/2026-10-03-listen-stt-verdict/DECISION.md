---
effort: listen-stt-verdict
status: concluded
concluded: 2026-10-03
summary: One speech-recognition check, stt-engine.sh, now decides for listen.sh, the voice band and /speak status alike — and it covers the Silero speech detector, whose absence the band used to miss.
tags: [voice, stt, health]
---

# listen.sh uses the shared STT verdict

> "do the listen.sh follow-up" — the follow-up recorded in `2026-10-03-toolkit-mods`: listen.sh kept its own
> whisper existence check instead of `voice_stt_verdict`.

**Why it couldn't just call the verdict.** `voice-health.sh` *sourced* `listen.sh` to learn whisper's paths, so
listen.sh calling back into voice-health would have been a cycle. The dependency pointed the wrong way: both are
consumers of one engine. So the engine became its own module, `scripts/stt-engine.sh` — the input mirror of
`tts-engine.sh` — owning the paths, model choice, Silero detector and `voice_stt_verdict`. listen.sh and
voice-health.sh both source it.

**The gap it closed.** The old verdict checked whisper-cli and its model but not the Silero detector, which
listen.sh has required since the Silero VAD work. A machine without the detector got a quiet (healthy) voice band
and then "speech detector missing" on the first ask. The verdict now covers what listen.sh needs, and RUNS both
binaries (`--help`), so a present-but-broken install is reported too.

Verified by hand on a healthy install and with overrides for: missing detector, broken whisper-cli, broken
detector — voice-health.sh, listen.sh and `/speak status` give the same answer in each.
