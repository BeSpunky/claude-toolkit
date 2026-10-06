// A DNS label — what a worktree's `<slug>.localhost` host is made of.
//
// The SAME rule as `toDnsLabel` in the dev engine (dev/files/lib/worktrees.mjs.tpl), which is what actually serves
// a tree at `<slug>.localhost`. That copy runs in the consumer's repo on Node built-ins alone and cannot import this
// package, so two copies are inherent; the generator side needs it to bake the main tree's slug into code that
// must recognise that host (the worktree tab label). tools/test-generators asserts the two agree — keep them in step.

/** Coerce a string into a valid DNS label (lowercase `[a-z0-9-]`, no edge hyphens, ≤ 63 chars). */
export function toDnsLabel(input: string): string {
  const label = input
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return label || 'app';
}
