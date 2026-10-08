# Inbound handoff #2 (summary) — from our-journey, nx-tools 0.47.0

User, 2026-10-07: *"Analyze this handoff as well. Treat it as info and suggestion, make your own analysis and conclusions. See if it fits our toolkit vision to incorporate it."*

- **Symptom:** worktree serve at offset 12000, app opened without `?portOffset=` → Google sign-in popup went to `localhost:9099` (nothing there) → blank, hangs. With `proxied: true` on auth it works.
- **Gap 1:** migration 0.24.3's interface step treats `environment.interface.ts` as current when every member declares `default:` — so an interface from the 0.7.1 scaffold repair (`default` but no `proxied?`) never got `proxied?`, and the promised one-word opt-in was a compile error. Template comments contradicted each other about which services `proxied` applies to.
- **Observation 2:** the port offset lives only in the URL (+ localStorage); any other way of opening the app silently points every service at base ports → hangs, not errors. Suggests the dev server serve the offset (meta/JSON).

## Orchestrator's conclusions

- **Observation 2 is already solved, more strongly than suggested**, by W4 (0.50.0 `route-emulators-through-origin`): the browser reaches every emulator through the page's own origin, so it needs no offset at all — no URL switch, no meta endpoint, nothing to forget. Serving the offset to the page would have kept the browser coupled to ports the host may have remapped anyway.
- **Gap 1's concrete instance dissolves**: `proxied` and its type are retired; the 0.50.0 migration removes it from value files and the interface together. Contradicting comments are gone (verified: no `proxied` left in generator sources). Re-fixing 0.24.3 is pointless — projects past it never re-collect it.
- **The class it reveals is real and worth fixing across the toolkit**: a migration's "already current" guard keyed on ONE marker of the new shape, while historical intermediate shapes carry that marker without the rest. Idempotence tests can't catch it (they re-run on the migration's own output). → audit every migration's skip guard + teach the harness about historical shapes.
