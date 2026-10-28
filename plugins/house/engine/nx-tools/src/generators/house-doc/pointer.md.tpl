<!-- @bespunky/house-tooling:start (generated pointer — do not edit between these markers; `house.sh upgrade` regenerates it) -->
## House rules & tooling

The house **directives** that govern every change in this project — {{#plugin-bespunky-engineering}}architect mentality, **architecture-first**, {{/plugin-bespunky-engineering}}{{#ui}}{{#plugin-bespunky-product-ux}}redesign-means-rethink, {{/plugin-bespunky-product-ux}}{{/ui}}{{#design-system}}{{#plugin-bespunky-design-system}}**design-system-first**, {{/plugin-bespunky-design-system}}{{/design-system}}{{#plugin-bespunky-workflow}}the **branch & release rules**, **a feature is a package**, {{/plugin-bespunky-workflow}}**generator-first** — are imported on the line below, so they are **always in context**. They are **mandatory, not optional reference.**

@HOUSE.rules.md

The **mechanical how-to** — the stack{{#design-system}} · the design system{{/design-system}}{{#web}} · serve · worktrees · the shared browser{{/web}}{{#firebase}} · Firebase{{/firebase}} · generators · Nx{{#web}} · Playwright{{/web}} — lives in **[`HOUSE.md`](HOUSE.md)**. **Read it before you branch{{#design-system}}, style{{/design-system}}{{#web}}, serve, drive the browser{{/web}}, or reach for a house command.**

Both files are **generator-owned**, regenerated on every `house.sh upgrade` to match the installed `@bespunky/nx-tools`. **Never hand-edit them** — this project's own guidance goes below, outside these markers.
<!-- @bespunky/house-tooling:end -->
