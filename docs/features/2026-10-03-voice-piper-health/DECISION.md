# voice-piper-health — decision

## The problem

> "Our voice skills work, but speech sounds robotic"

The natural voice (Piper) was installed on this machine — binary executable, three
voice models on disk — but its bundled shared libraries had lost their soname
symlinks (`libpiper_phonemize.so.1 → …so.1.2.0`, likely a copy of
`~/.claude/bespunky-voice/piper` that didn't preserve links). Piper died in the
dynamic linker on every call. Nothing said so:

- `speak.sh` ran piper with `2>/dev/null` and fell through to espeak-ng.
- `install-piper.sh` judged the install by `[ -x piper ]` and reported "already present".
- `/voice status` didn't mention the engine at all.

## The decision

**Health is decided by running piper, never by finding its files.** One sourced
helper, `scripts/tts-engine.sh` (sibling of `audio-endpoint.sh`), owns where Piper
lives, which voice is default, and the synth/probe that proves it works. Its three
callers:

- `speak.sh` synthesizes through it; an installed-but-broken piper still falls back
  to espeak-ng (speech beats silence) but **says so on stderr** with piper's own error
  and the repair command.
- `install-piper.sh` replaces a binary that can't run (`--version` loads every linked
  library), copies with `cp -a` so the links survive, and ends by synthesizing a word
  — "done" means the natural voice will speak.
- `voice-auto.sh status` (`/voice status`) reports the engine that will actually
  speak, with the reason and the repair when it's the fallback. This covers auto-speak,
  whose detached runs discard stderr.

## Roads not taken

- **A per-utterance "last engine" state file** for the detached runs: unneeded — the
  live probe in `status` answers the same question without new state.
- **Treating `piper --version` as the full health check**: it proves the libraries
  load but not that the voice model works; the probe synthesizes a real word.
