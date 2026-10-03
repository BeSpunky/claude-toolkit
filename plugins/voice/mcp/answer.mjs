// bespunky-voice — answer.mjs
//
// UNDERSTANDING a spoken reply — pure functions, no I/O, so they're testable
// without a microphone. Two questions, asked in this order:
//   1. classifyIntent — is the reply about the CONVERSATION itself ("repeat
//      that", "stop") rather than an answer to the question?
//   2. matchOption    — if it's an answer, which offered option does it pick?

const norm = (s) => ' ' + String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

// A control phrase counts only when it is (nearly) the WHOLE reply: "stop" is a
// command, but "no, stop doing that" is an answer that happens to contain it.
const POLITE = '(?:please |now |then |it |that |again )*';
const REPEAT = new RegExp(
  `^ (?:sorry |pardon |what |huh )*(?:` +
  `repeat(?: that| it| the question| yourself)?|say (?:that|it) again|come again|again|` +
  `what did you say|can you repeat(?: that| it| the question)?|could you repeat(?: that| it| the question)?|` +
  `pardon|what|huh|sorry` +
  `) ${POLITE}$`);
const CANCEL = new RegExp(
  `^ (?:ok |okay )?(?:` +
  `stop|cancel|never ?mind|forget (?:it|that)|quiet|be quiet|shut up|abort|` +
  `stop listening|cancel that|never mind that` +
  `) ${POLITE}$`);

/** 'repeat' | 'cancel' | null — null means "treat it as an answer". */
export function classifyIntent(transcript) {
  const t = norm(transcript);
  if (REPEAT.test(t)) return 'repeat';
  if (CANCEL.test(t)) return 'cancel';
  return null;
}

// Map a spoken transcript to an option. Order: exact label phrase → ordinal/number
// → yes/no for two-option questions. Returns null when nothing is confident.
const ORD = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const ORDW = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

export function matchOption(transcript, opts) {
  if (!opts.length) return null;
  const t = norm(transcript);

  // "unsure" answers must NOT be forced into a choice (e.g. "no idea" is not "no").
  if (/\b(no idea|not sure|dont know|do not know|no clue|unsure|cant decide|cannot decide|neither)\b/.test(t)) return null;

  // 1. an option label appears in the transcript (prefer the longest match)
  let best = null;
  opts.forEach((o, i) => {
    const label = norm(o.label).trim();
    if (label && t.includes(' ' + label + ' ')) {
      if (!best || label.length > best.len) best = { index: i, label: o.label, by: 'label', len: label.length };
    }
  });
  if (best) { delete best.len; return best; }

  // 2. "option/number/choice N", an ordinal word (first/second/…), or a lone digit.
  // Deliberately NOT bare cardinals ("one"/"two") — "one" hides in "second one",
  // "someone", "the one".
  for (let i = 0; i < opts.length; i++) {
    const n = i + 1;
    if (new RegExp(`\\b(option|number|choice)\\s+(${ORD[i]}|${ORDW[i]}|${n})\\b`).test(t)) return { index: i, label: opts[i].label, by: 'ordinal' };
    if (new RegExp(`\\b${ORDW[i]}\\b`).test(t)) return { index: i, label: opts[i].label, by: 'ordinal' };
    if (new RegExp(`\\b${n}\\b`).test(t)) return { index: i, label: opts[i].label, by: 'number' };
  }

  // 3. yes/no for a two-choice question
  if (opts.length === 2) {
    if (/\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|affirmative)\b/.test(t)) return { index: 0, label: opts[0].label, by: 'affirm' };
    if (/\b(no|nope|nah|dont|do not|cancel|stop|skip|negative)\b/.test(t)) return { index: 1, label: opts[1].label, by: 'negate' };
  }
  return null;
}
