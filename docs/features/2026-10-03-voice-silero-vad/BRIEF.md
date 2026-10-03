# voice-silero-vad — brief

## In the user's words (2026-10-03)

> Why did the live transctibed text show "Next time."?

…during the first live hands-free test, whose final transcript was "Yeah, it's done."
After the explanation and the proposal: "yes, do it".

## Root cause

Whisper hallucinates on non-speech audio — trained largely on subtitled video, it
fills silence and room noise with outro phrases ("Thank you.", "See you next time.").
`listen.sh` hands it non-speech in three places: the first partials (before the user
starts talking), the short-run check that decides "a word or a cough?", and the
no-speech check that decides "is someone talking under the noise?". The latter two
make hallucination a CONTROL-FLOW bug, not just a display one: invented words can end
a take on a cough, or keep one alive in an empty room. (Synthetic white/brown noise
doesn't reproduce it — whisper labels that "(static)", already stripped — so real
mic noise is the trigger.)

## The fix (confirmed)

A real speech detector instead of loudness rules: whisper.cpp's Silero VAD (a ~2 MB
model, `ggml-silero-*.bin`). Recognition only ever sees stretches that contain
speech, and the same detector decides when speech started and ended — replacing the
hand-tuned energy VAD (noise floor, hysteresis, recogniser-as-arbiter, by-words mode).
`install-whisper.sh` fetches the model.
