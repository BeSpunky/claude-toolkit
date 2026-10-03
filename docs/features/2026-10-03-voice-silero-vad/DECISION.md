---
status: concluded
concluded: 2026-10-03
summary: Silero VAD decides what is speech and when it ended; whisper only transcribes speech, so room noise can no longer become words or steer end-of-speech; the listener tick clock no longer crashes on Stop.
tags: [voice, stt, vad, whisper, hallucination, bash]
---

# voice-silero-vad — decision

Brief and root cause: [`BRIEF.md`](BRIEF.md). Confirmed by the user: "yes, do it".

## The decision

**A speech detector decides what is speech; whisper only transcribes it.** Silero VAD
(whisper.cpp's `whisper-vad-speech-segments` + `ggml-silero-v6.2.0.bin`, installed by
`install-whisper.sh`) runs over the take every 0.3 s (~110 ms on a 20 s take): heard =
a speech segment exists, ended = SILENCE_SECONDS past the last one, no-speech = none by
NO_SPEECH_SECONDS. Partials and the final pass run with `--vad`, so silence is never
transcribed. The energy VAD and every recogniser-as-arbiter path are deleted — they were
the places a hallucination could steer control flow. A missing detector fails clearly;
there is no fallback to loudness rules.

Evidence: real room noise → `small.en` without `--vad`: "you"; with `--vad`: nothing.
Scenarios (bare "yes", mid-answer pause, quiet continuation, cough + answer, cough /
noise / room only, 12 s answer at SNR 8 and 4) all behaved; SNR 4 misheard one phrase.

## Found on the way — the stuck "listening…" strip

The user asked: "I keep seeing the 'listening...' strip. Is that supposed to happen?"
At that moment it was honest (the build's real-mic tests were recording), but the build
also surfaced a real bug: the tick clock (builtin `read -t` on a FIFO) crashed or hung
bash when a TERM to the pid — the band's Stop — landed in it, leaving the recorder
running and the announcement up. Reproduced 7/60 with that clock in the VAD loop;
0/60 with the replacement, a background `sleep` + `wait`. (The previous energy-VAD
loop didn't reproduce in 40 runs; the hazard is the builtin, not the loop.)

## Release
bespunky-voice 0.7.0 (minor: a new required install piece — existing installs re-run
`install-whisper.sh` once; listen.sh says so if they don't). No payload change.
