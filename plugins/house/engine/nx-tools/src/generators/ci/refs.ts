// A BRANCH NAME OR GLOB, AS A REGULAR EXPRESSION ON THE FULL REF — the one translation every matcher shares.
//
// Three things decide whether a push may deploy, and they must agree on what a binding's glob means or the gaps
// between them surface as cryptic failures (a run that resolves an environment, then fails at auth):
//   - GitHub's `on.push.branches` filter (the workflow file) — `*` never crosses `/`;
//   - the resolve job, which maps the pushed ref to its environment (bash `[[ =~ ]]`, ERE);
//   - the cloud provider's attribute condition on the OIDC token's `ref` claim (CEL `matches`, RE2).
// So both of ours are rendered from THIS function, with GitHub's semantics: `*` is one or more characters that are
// not `/`. ERE and RE2 agree on everything it emits (anchors, `[^/]+`, backslash-escaped literals).

/** `release/*` → `^refs/heads/release/[^/]+$`; a plain name is matched exactly (its metacharacters escaped). */
export function branchRefRegex(branch: string): string {
  const body = branch
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return `^refs/heads/${body}$`;
}
