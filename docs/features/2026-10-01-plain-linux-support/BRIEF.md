# Plain-Linux support

> "Our toolkit currently expects WSL. Send agents to look for any place that speaks WSL and make it support plain linux" — the user, 2026-10-01

Goal: every place the toolkit assumes a WSL host (WSLg mounts, wsl.exe, Windows-side paths, docs that say "WSL") works on a plain Linux host too — by modelling the host platform, not by sprinkling `if wsl` branches.

Out of scope: rewriting past feature packages (history is not edited); `spikes/` (throwaway evidence).
