# Sanity review: angularfire-peer-firebase (0.51.1)

Mode: fix. Budget: 5 agents. Scope: `git diff development...HEAD` (217fb6be).

## Frame

Unblock the nx-tools publish: AngularFire 22.0.0-rc.0 moved `firebase` to `peerDependencies`, which the upstream-table
projection treated as fatal. Ships as 0.51.1 with the full table refresh. User decision (not a finding): go ahead with
0.51.1, moving new Angular + Firebase projects to Angular 21 and making Node 26 the newest LTS. HOUSE_NODE_MAJOR stays 24.

Challenge: (1) the "nothing to migrate" finding, incl. lts/*, node, latest with LTS=26, NEWEST=27; (2) remaining
assumptions that firebase is in AngularFire's dependencies; (3) what Angular 21 breaks for new scaffolds; (4) tests
hard-coded to today's upstream answer.

## Lenses

- R1 correctness + migration question (challenge 1)
- R2 completeness + architecture: the dependencies sweep (challenge 2), and tests derived from the table (challenge 4)
- R3 Angular 21 scaffolds (challenge 3)
- V1, V2 adversarial verifiers

## Status

- Reviewers returned (R1, R2, R3). Verifiers V1, V2 dispatched.

## Findings as returned, deduplicated (verdicts follow)

| Id | Sev | Anchor | Claim |
| --- | --- | --- | --- |
| N1 | high | tools/node-facts/project.mjs:41 | NODE_NEWEST_MAJOR=27 counts v27.0.0-alpha; no prerelease filter |
| N2 | high | house-probe.mts:93, node-spec.ts:67 | node/latest/current/stable now refused on upgrade (follows N1); structural gap for a real odd major |
| T1 | high | firebase-compat/project.mjs:160, firebase-compat.ts:210 | Angular 21 TS pin ~6.0.3 outside @angular/build, ng-packagr, AF 21 peers (<6.0): npm ERESOLVE |
| P1 | high | angularfire.ts:157-162, HOUSE.md.tpl:202 | "two SDKs" false for a peer; string compare warns on in-range peer |
| P2 | medium | angularfire.ts:209-214 | AF22 declared, firebase undeclared, nothing installed: refusal, though table knows the range |
| P3 | medium | angularfire.ts:62, project.mjs:191 | same dep/peer rule in two places; a shared pure helper is possible |
| M1 | medium | 0.50.0/pin-floating-dependencies.ts:137 via angularfire.ts:54 | rung reads project Node through LIVE node facts |
| N3 | medium | angularfire-judge.ts:63 | major above table ceiling: empty "needs Node ;" refusal |
| S1 | medium | angularfire.ts:156, judge coherentPair | project on 21.0.0-rc.1 stranded silently, and its Node gap is lost |
| S2 | medium | angularfire.ts:244-248 | candidate selection ignores minAngular (Nx 22.3-22.5 gives ~21.0/~21.1, AF 21 needs ^21.2) |
| Q1 | high | versions.mjs:219-231 | PEER kept case passes on broken code; uncovered peer paths |
| Q2 | medium | versions.mjs | judge cases read the live table; needs a table seam |
| Q3 | medium | dogfood-consumer/run.mjs:586 | verify runs build + lint only, not test |
| Q4 | low-med | versions.mjs:250,213,219,294 | test names and messages lie |
| F1 | low-med | firebase-emulators/generator.ts:743 | lts/* functions project: deploys 24, runs 26, says nothing |
| D1 | low-med | project.mjs:5-8,25, workspace-angular.ts:5, angularfire.ts:4,9 | stale comments |
| D2 | low | tips.txt:25, node-version.ts:14 | "no upgrade moves it" false for an alias |
| D3 | low | HOUSE.md.tpl:199-221 | no zoneless note for Firebase emissions |
| D4 | low | firebase.config.ts.tpl:25, service-configs.ts:30 | measured bundle numbers are from an older stack |
| Z1 | low | angularfire.ts:275, adapters/angular/index.ts:115 | major<21 copy of Nx's private zoneless default |
| L1 | medium | adapters/angular/libs.ts:48 | Angular 21 publishable lib lint fails dependency-checks (replay, unproven under house generators) |
| R1 | medium | nx-tools/package.json:3, commit msg | no bump, no migration statement, DECISION summary stale (session's: out of bounds here) |

## Verdicts and outcomes

| Id | Verdict | Outcome |
| --- | --- | --- |
| N1 | stands | Fixed: projector filters prereleases; both tables re-projected. NEWEST back to 26, nodeMajors drop 27 |
| N2 | regression stands (via N1); structural half refuted (refusing an imageless major is documented) | Fixed by N1. Open: a real 27 refuses `node` projects, see decision below |
| T1 | stands | Fixed: pin is the intersection of compiler-cli, @angular/build, ng-packagr, @angular/fire. Only row 21 moved: ~6.0.3 to ~5.9.3. Verifier observed ~5.9.3 survive to disk, build and test green |
| P1 | stands (false positive new in this diff) | Fixed: firebaseIs modelled; peer has its own message and a range check; docs rewritten |
| P2 | refuted: upgrade installs first; hand-run residue refuses loudly | None |
| P3 | feasible but publish.sh runs project.mjs on the host Node before its Node check | Kept two copies with cross-references; added the optional-peer alarm |
| M1 | contract breach stands, latent | Fixed: rung passes its frozen Node facts; discriminating case, mutation-checked |
| N3 | stands, worse than reported | Fixed: only a recorded engines.node refuses |
| S1 | no-finding half stands; Node half refuted in practice | Fixed: info finding names the stable |
| new | Angular 21.0/21.1 on AF 20 said "no stable existed" | Fixed |
| S2 | refuted: probe refuses first; Nx below 22.6 is outside the peer range | None |
| Q1 | stands | Fixed: stronger kept case, three uncovered peer paths covered |
| Q2 | stands | Fixed: table parameter, FIXTURE_TABLE; new+firebase derives from the live table |
| Q3 | stands, but adding `test` goes red: Angular DS ships no spec | Open, decision below |
| Q4 | stands | Fixed |
| F1 | stands; node-version log line also false | Fixed |
| D1, D2 | stand (node-version.ts:14 refuted) | Fixed |
| D3 | stands, confirmed at runtime | Fixed in HOUSE.md.tpl; skill wording left, needs a bespunky-angular bump |
| D4 | low, needs measuring | Open |
| Z1 | stands | Fixed: appIsZoneless, stated to the generator. Not exercised: @nx/angular absent here |
| L1 | stands, pre-existing | Open |
| R1 | stands; session's work | Open, reported |

## Not covered

Angular generator cases skip here (27, optional peers absent). No real `new`, upgrade or dogfood: owed by the session.
