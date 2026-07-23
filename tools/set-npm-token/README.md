# set-npm-token

Writes an npm auth token into your per-user **`~/.npmrc`** — the file `publish-nx-tools/publish.sh`
reads credentials from. This is the one-step way to set up an **automation token** so publishes run
unattended (no interactive `npm login`, no 2FA OTP window that can expire mid-publish).

`~/.npmrc` is in your **home** directory (`/home/<you>/.npmrc`) — *not* `/usr`. npm never reads user
auth from `/usr`.

## Usage

```bash
tools/set-npm-token/set-npm-token.sh
# → prompts silently for the token, writes //registry.npmjs.org/:_authToken=<token> to ~/.npmrc (chmod 600)

# a different registry (e.g. GitHub Packages) or a project-local file:
tools/set-npm-token/set-npm-token.sh --registry https://npm.pkg.github.com --npmrc ./.npmrc
```

The prompt is silent (the token never echoes to the terminal or shell history), the write is
**idempotent** (it replaces any existing `_authToken` for that registry instead of appending
duplicates), and the file is `chmod 600`. The token is still stored in **plaintext** — that's how npm
reads it — so treat `~/.npmrc` as a secret and prefer a **granular/automation token** (npm → Access
Tokens) scoped to only what it publishes, not your account password.

## For Claude: the "token stays private" workflow

The whole point of this script is that **the human types the token; Claude never sees it.** So when a
publish (`publish-nx-tools/publish.sh`) fails on auth — `ENEEDAUTH`, `401`, `E403`, "missing `~/.npmrc`",
or a 2FA OTP that expired mid-run — **do not ask for the token in chat, and do not run this script
yourself.** The Bash tool is not an interactive TTY the human can type into, and pasting a token into
the conversation would expose it.

Instead: **tell the human to run `tools/set-npm-token/set-npm-token.sh` in their own terminal** (they
enter the token at the silent prompt), then re-run the publish. That keeps the secret off-screen and out
of the transcript.
