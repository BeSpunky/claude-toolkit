// THE THIRD-PARTY CODE THE DEPLOY WORKFLOW RUNS — pinned by full commit SHA, in ONE place.
//
// A tag (`@v4`) is a pointer its owner (or whoever compromises the owner) can move; the deploy job runs with a
// cloud identity that can ship to production, so every action it — or a job feeding it — uses is pinned to the
// commit that was reviewed, with the release it came from kept beside it. Dependabot / Renovate understand this
// `@<sha> # vX.Y.Z` form and propose bumps. Moving a pin is editing this table (and re-reviewing the action).
export interface PinnedAction {
  /** `owner/repo[/path]` */
  uses: string;
  sha: string;
  /** The release the SHA is, for humans and for update bots. */
  version: string;
}

export const ACTIONS = {
  checkout: { uses: 'actions/checkout', sha: '11d5960a326750d5838078e36cf38b85af677262', version: 'v4.4.0' },
  setupNode: { uses: 'actions/setup-node', sha: '49933ea5288caeca8642d1e84afbd3f7d6820020', version: 'v4.4.0' },
  cacheSave: { uses: 'actions/cache/save', sha: '0057852bfaa89a56745cba8c7296529d2fc39830', version: 'v4.3.0' },
  cacheRestore: { uses: 'actions/cache/restore', sha: '0057852bfaa89a56745cba8c7296529d2fc39830', version: 'v4.3.0' },
  nxSetShas: { uses: 'nrwl/nx-set-shas', sha: '3e9ad7370203c1e93d109be57f3b72eb0eb511b1', version: 'v4.4.0' },
  googleAuth: { uses: 'google-github-actions/auth', sha: 'c200f3691d83b41bf9bbd8638997a462592937ed', version: 'v2.1.13' },
} as const satisfies Record<string, PinnedAction>;

/** The `uses:` value: `owner/repo@<sha> # <version>`. */
export const uses = (action: PinnedAction): string => `${action.uses}@${action.sha} # ${action.version}`;
