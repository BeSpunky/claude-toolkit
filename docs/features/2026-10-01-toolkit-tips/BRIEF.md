# Toolkit tips — brief

## The ask (verbatim)

> Add a feature to our toolkit that automatically gives users who install it ocassional tips and tricks on how to take advantage of the capabilities we're offering. It should be automatically installed and configured along with the toolkit and can't be intrusive or abrupt. It has to be a subtle tip each time, that the user can choose to read or not. It can't be part of the conversation itself

## Constraints distilled

- **Automatic**: arrives with the toolkit install; no setup step.
- **Subtle, optional to read**: a glanceable line, never a prompt, never a block of text.
- **Outside the conversation**: never injected into the model's context, never a chat turn.
- **Occasional**: rotating, not the same line every time.

## Surfaces Claude Code offers a plugin (researched 2026-10-01, code.claude.com docs)

| Surface | Outside the conversation? | Plugin can enable it itself? |
| --- | --- | --- |
| Spinner tips (`spinnerTipsOverride` setting, `{tips, replaceBuiltInTips}`) | Yes: rotates in the "working…" spinner | **No**: a plugin `settings.json` honours only `agent` + `subagentStatusLine`; every other key is dropped. A hook would have to write it into the user's own settings file. |
| Hook `systemMessage` (JSON stdout, exit 0) | Shown to the user, **not** the model | Yes: pure plugin hook, nothing written outside the plugin |
| Status line | Yes | No: user setting only, and it is a single slot the user may already own |
| Plain SessionStart stdout | **No**: lands in model context | n/a, ruled out |

There is no plugin uninstall event, so anything a hook writes into user settings outlives the plugin.
