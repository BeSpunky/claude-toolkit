// bespunky-workflow — the MERGE GATE: when Claude is done and proposes to land its work branch on the
// integration line (or to promote that line onward), a band above the prompt offers the move as one press —
// Land, Land & promote, Push the branch, or Not yet — instead of a "shall I merge?" the person types back.
//
// WHY CLAUDE TRIGGERS IT. "Done" is a judgement, not a git state: a branch ahead of integration is landable
// in every minute of an effort, and a gate drawn from git alone would nag throughout. So the trigger is
// Claude's own explicit signal — the `propose_move` tool it calls as the last act of a turn that proposes a
// move — never a guess read off its prose.
//
// WHY IT IS A VIEW OVER THE ENGINE. What the integration line is called, which stage comes next, whether
// promoting there is a move the model has at all: the branch-model engine decides (`status --json`, and
// `plan promote <stage>` exiting 0), read through ./branch-engine.ts. Git says only how far a line is ahead.
// The fold is `gateOf`, pure; everything else is plumbing.
//
// DETECT, DON'T EXECUTE. A press is the person's explicit signal, and it is sent AS their prompt; Claude then
// carries the move out by bespunky-workflow:branch-and-release, which owns the judgement steps a landing
// needs (rebase and re-verify, the package's DECISION.md, keep-or-bin mocks). The mod never runs a mutating
// command. Prompts carry only names the engine and git vouched for; Claude's note is drawn, never sent.
//
// THE PLUGIN WORKS WITHOUT IT. With mods off the tool does not exist and Claude asks in prose, as the skill
// says. Its lifetime: drawn once the turn is over (never while Claude works), gone on the person's next
// prompt — a press or anything typed — or on Not yet.

import { update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MergeGate, MergeGateMove } from '../types/index.d.ts'

import { BrandFrame } from './_brand.tsx'
import { enginePath, isProtected, oneLine, parseStatus } from './branch-engine.ts'
import type { Model } from './branch-engine.ts'

const GATE = { plugin: 'bespunky-workflow', key: 'mergeGate' } as const
const TOOL = 'propose_move'
/** Module-private on purpose: `claude plugin validate` reads a matcher only from a const nothing else references. */
const TOOL_ID = 'mcp__bespunky-workflow__propose_move'
const SKILL = 'bespunky-workflow:branch-and-release'
/** The person's own prompts: typed at the terminal, or through Remote Control. Module-private, as TOOL_ID. */
const PERSON = /^(composer|bridge)$/

/** A git branch name safe to put in a prompt: no option-looking lead, no `..`, no spaces or shell glyphs. */
const BRANCH = /^(?![-/.])(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/
const NOTE_MAX = 200

/** What Claude proposed, as the tool's input says it. */
export type Proposal =
  | { gate: 'land'; branch: string; note: string }
  /** `stage` defaults to the first stage after integration. */
  | { gate: 'promote'; stage?: string; note: string }

/** What the engine and git said about the proposal. */
export type Facts = {
  model: Model
  /** Commits the source has over the target (the branch over integration; the stage's predecessor over it). Undefined when git could not tell — a line that does not exist. */
  ahead?: number
  /** The engine plans `promote` to the stage in question (for land: the first stage after integration). */
  canPromote: boolean
}

/** The tool's input, checked; a string says what is wrong with it. */
export function parseProposal(input: Record<string, unknown>): Proposal | string {
  const note = typeof input.note === 'string' ? oneLine(input.note).slice(0, NOTE_MAX) : ''

  if (input.gate === 'land') {
    return typeof input.branch === 'string' && BRANCH.test(input.branch)
      ? { gate: 'land', branch: input.branch, note }
      : '`branch` must name the work branch to land'
  }
  if (input.gate === 'promote') {
    if (input.stage === undefined) return { gate: 'promote', note }

    return typeof input.stage === 'string' && BRANCH.test(input.stage)
      ? { gate: 'promote', stage: input.stage, note }
      : '`stage` must name a stage of the branch model'
  }

  return '`gate` must be `land` or `promote`'
}

/** The stage a proposal could promote to: the named one, or the first after integration. */
export function stageOf(proposal: Proposal, model: Model): string | undefined {
  if (model.state !== 'declared') return undefined

  return proposal.gate === 'promote' && proposal.stage !== undefined ? proposal.stage : model.chain[1]
}

/** The line a stage is promoted from: its predecessor in the chain. */
export function sourceOf(stage: string, model: Model): string | undefined {
  if (model.state !== 'declared') return undefined
  const at = model.chain.indexOf(stage)

  return at > 0 ? model.chain[at - 1] : undefined
}

/** The whole policy: the gate to draw, or why none is drawn (said back to Claude, who then asks in prose). */
export function gateOf(proposal: Proposal, facts: Facts): { gate: MergeGate } | { refusal: string } {
  const { model } = facts
  if (model.state !== 'declared') {
    return { refusal: 'no branch model is declared, so there is no integration line to offer' }
  }
  const stage = stageOf(proposal, model)

  if (proposal.gate === 'promote') {
    const from = stage === undefined ? undefined : sourceOf(stage, model)
    if (stage === undefined || from === undefined || !facts.canPromote) {
      return { refusal: `the branch model (${model.summary}) has no promotion${stage === undefined ? '' : ` to ${stage}`}` }
    }
    if (!facts.ahead) {
      return { refusal: `${from} has nothing ${stage} lacks` }
    }

    return {
      gate: {
        headline: `${from} → ${stage} · ${commits(facts.ahead)}`,
        note: proposal.note,
        moves: [
          {
            id: 'promote',
            label: `Promote to ${stage}`,
            hotkey: 'm',
            prompt: `Promote ${from} to ${stage} — I pressed Promote in the merge gate. Follow ${SKILL} (plan promote ${stage}).`,
          },
        ],
      },
    }
  }

  const { branch } = proposal
  const into = model.integration
  if (isProtected(branch, model)) {
    return { refusal: `${branch} is a protected line; only a work branch lands` }
  }
  if (facts.ahead === undefined) {
    return { refusal: `there is no branch ${branch}` }
  }
  if (facts.ahead === 0) {
    return { refusal: `${branch} has nothing ${into} lacks` }
  }

  const moves: MergeGateMove[] = [
    {
      id: 'land',
      label: `Land on ${into}`,
      hotkey: 'l',
      prompt: `Land ${branch} on ${into} — I pressed Land in the merge gate. Follow ${SKILL} (plan land ${branch}).`,
    },
  ]
  if (stage !== undefined && facts.canPromote) {
    moves.push({
      id: 'land-promote',
      label: `Land & promote to ${stage}`,
      hotkey: 'm',
      prompt: `Land ${branch} on ${into}, then promote ${into} to ${stage} — I pressed Land & promote in the merge gate. Follow ${SKILL} (plan land ${branch}, then plan promote ${stage}).`,
    })
  }
  moves.push({
    id: 'push',
    label: 'Push branch',
    hotkey: 'p',
    prompt: `Push ${branch} to ${model.remote} without landing it — I pressed Push in the merge gate.`,
  })

  return { gate: { headline: `${branch} → ${into} · ${commits(facts.ahead)}`, note: proposal.note, moves } }
}

/** What the tool answers Claude when the gate is up: what the person sees, and that the turn should end. */
export function shownText(gate: MergeGate) {
  const offered = [...gate.moves.map(move => move.label), 'Not yet'].join(' · ')

  return `The person now sees a merge gate above the prompt: ${offered}. End your turn now without asking again in prose — their press arrives as their next prompt; if they type instead, follow what they say.`
}

export function refusedText(why: string) {
  return `Merge gate not shown: ${why}. Ask the person in prose instead.`
}

function commits(n: number) {
  return `${n} commit${n === 1 ? '' : 's'}`
}

export const register: Register = on => {
  // Only where a person is at the prompt: a headless run has no one to press, and the skill asks in prose.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await $.tool.register({
      name: TOOL,
      description:
        "Show the person a merge gate: one-press buttons above the prompt to land your work branch on the branch model's integration line (and, where the model allows, land and promote, or push the branch), instead of asking 'shall I merge?' in prose. Call it as the LAST action of a turn in which the work is done and verified and you are proposing to land it (gate: land), or proposing to promote onward after a landing (gate: promote). It changes nothing itself: the person's press arrives as their next prompt, and you then carry the move out by bespunky-workflow:branch-and-release. If it answers 'not shown', ask in prose.",
      inputSchema: {
        type: 'object',
        properties: {
          gate: { type: 'string', enum: ['land', 'promote'], description: 'land: land a work branch on integration. promote: advance integration (or a stage) to the next stage.' },
          branch: { type: 'string', description: 'gate land: the work branch to land, e.g. feat/x.' },
          stage: { type: 'string', description: 'gate promote: the stage to promote to; omitted = the first stage after integration.' },
          note: { type: 'string', description: 'One short line on what is ready, shown to the person.' },
        },
        required: ['gate', 'note'],
      },
    })

    return next(e)
  })

  // The call's arguments sit beside `tool` and `tool_use_id` on the event itself.
  on('tool.call', { tool: TOOL_ID }, async ($, e) => ({ result: await propose($, e as Record<string, unknown>) }))

  // Anything the person typed instead answers the gate too (a press clears it itself).
  on('prompt.submit', { origin: { kind: PERSON } }, async ($, e, next) => {
    await update($, GATE, () => null)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking) return next(e)
    const { value: gate } = await $.state.get(GATE)
    if (!gate) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui

    return (
      <BrandFrame ui={ui} site={e}>
        <Text bold wrap="truncate-end">
          {gate.headline}
        </Text>
        {gate.note !== '' && <Text dimColor>{gate.note}</Text>}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {gate.moves.map((move, index) => (
            <Button
              key={`merge-gate-${move.id}`}
              label={move.label}
              hotkey={move.hotkey}
              {...(index === 0 ? { variant: 'primary' as const } : {})}
              onPress={() => void press($, move)}
            />
          ))}
          <Button key="merge-gate-dismiss" label="Not yet" hotkey="n" role="dismiss" onPress={() => void dismiss($)} />
        </Box>
      </BrandFrame>
    )
  })
}

/** Reads the facts the proposal needs, folds them, and stores the gate (or says why not). */
async function propose($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const proposal = parseProposal(input)
  if (typeof proposal === 'string') return refusedText(proposal)

  const model = await readModel($)
  const stage = stageOf(proposal, model)
  const canPromote = stage !== undefined && (await run($, ['node', enginePath($.plugin.root), 'plan', 'promote', stage]))?.exitCode === 0
  const [source, target] =
    proposal.gate === 'land'
      ? [proposal.branch, model.state === 'declared' ? model.integration : undefined]
      : [stage === undefined ? undefined : sourceOf(stage, model), stage]
  const ahead = source !== undefined && target !== undefined ? await aheadOf($, source, target) : undefined

  const outcome = gateOf(proposal, { model, ahead, canPromote })
  if ('refusal' in outcome) return refusedText(outcome.refusal)
  await update($, GATE, () => outcome.gate)

  return shownText(outcome.gate)
}

/** Commits `source` has that `target` lacks, or undefined when either is not a local branch. */
async function aheadOf($: EngineInterface, source: string, target: string) {
  const ran = await run($, ['git', 'rev-list', '--count', `refs/heads/${target}..refs/heads/${source}`])
  const n = ran?.exitCode === 0 ? Number(ran.stdout.trim()) : NaN

  return Number.isInteger(n) && n >= 0 ? n : undefined
}

/** A move pressed: the gate goes, and the move is sent as the person's own prompt. */
async function press($: EngineInterface, move: MergeGateMove) {
  await update($, GATE, () => null)
  await $.prompt.submit({ text: move.prompt, asUser: true })
}

async function dismiss($: EngineInterface) {
  await update($, GATE, () => null)
}

async function readModel($: EngineInterface): Promise<Model> {
  const ran = await run($, ['node', enginePath($.plugin.root), 'status', '--json'])

  return ran ? parseStatus(ran.stdout) : { state: 'absent' }
}

/** A host command, or nothing when it could not start (no git, no node) or overran. */
async function run($: EngineInterface, argv: string[], timeoutMs = 15_000) {
  try {
    return await $.process.run(argv, { timeoutMs })
  } catch {
    return undefined
  }
}
