# Stack-agnostic toolkit

> "We're going to make out toolkit as project-agnostic as we can. Currently, our scaffolder thinks Angular+Firebase+Nx+maybe other things. Some of my projects aren't going to be Angular anymore. They might still need Nx but that's questionable as well. Same goes for Firebase. Find opportunities for decoupling and making everything as agnostic as possible so it fits every project and the `/sync` command is able to fix any project regardless of having a specific structure/stack. We still want special support for Angular, Nx, Firebase and what we support today, but as optional and "something to wear"" — the user, 2026-10-01

Goal: the toolkit (scaffolder, `/sync`, skills, house docs) assumes **no stack**. A bare repo of any language gets the house DX; Nx, Angular, Firebase, the design system, navigation — everything supported today — become **optional layers a project wears**, detected and applied only when present or asked for.

First deliverable: an audit of every coupling and a decoupling design, confirmed by the user before any implementation (architecture-first).
