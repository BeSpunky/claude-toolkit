---
effort: standing-skill-pane
summary: The project-standing skill knows about the /standing pane and offers it non-intrusively, with a button instead of a second, disconnected way to see the same thing.
---

User, on the skill and the pane being separate: *"That's rediculos. Integrate the two. The skill should know about the mod and propose the panel non-intrusively. Maybe by adding mod buttons that will run the `/standing` command?"*

## Design, as built

The trigger is the `skill.prompt` event, not an instruction in SKILL.md and not a tool Claude must call. The merge gate needs Claude's signal because "done" is a judgement; "this skill ran" is a fact the engine already has, on every road into the skill (`/name`, the Skill tool). Asking the model to remember would make the offer only as reliable as the model.

The user's suggestion was mod buttons "that will run the `/standing` command". Open pane calls the same `$.ui.open` the command does, rather than submitting `/standing` as a prompt: no extra row in the transcript, and the engine has just run.

Non-intrusive means: a band, never a pane opened unasked; drawn only once the turn is over; gone on Not now, the pane opening by any road, or the next prompt from the person or a plugin (a merge gate press is a plugin's prompt, and the offer must not resurface after it); no offer when the pane is already up (it is refreshed, and the skill's text says so) or the engine has nothing to say, which includes a project with no packages.

The other direction, because the user said to integrate the two: the pane's Catch me up runs the skill as the person's prompt, in fixed words.

## Observed

- `skill.prompt` carries `bespunky-workflow:project-standing` both typed and through the Skill tool (probe mod under `claude -p`, Haiku).
- A real interactive session in tmux on this branch's plugin: running the skill drew `Standing: 4 live, 0 dormant, 59 concluded.` with Open pane and Not now once the turn ended; Claude did not offer the pane itself; pressing Open pane opened it and took the band down.
