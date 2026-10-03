// bespunky-voice — answer.mjs
//
// UNDERSTANDING a spoken reply — pure functions, no I/O, so they're testable
// without a microphone. Two questions, asked in this order:
//   1. classifyIntent — is the reply about the CONVERSATION itself ("repeat
//      that", "stop") rather than an answer to the question?
//   2. matchOption    — if it's an answer, which offered option does it pick?
// When either is unsure it says so (null) — the caller reads the transcript
// itself rather than act on a guess.

// Apostrophes are DELETED, not spaced: "don't" must stay one word (dont), or every
// negation and "can't decide" silently stops matching.
const norm = (s) => ' ' + String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

// A control phrase counts only when it is (nearly) the WHOLE reply: "stop" is a
// command, but "stop the migration" is an answer that happens to contain it.
// People pad commands ("please stop", "no, stop", "stop, stop") — padding and
// repetition are allowed; any other word makes it an answer.
const PAD = '(?:(?:no|ok|okay|please|just|oh|sorry|um|uh|now|then|it|that|again) )*';
const control = (phrases) => new RegExp(`^ ${PAD}(?:(?:${phrases}) ${PAD})+$`);
const REPEAT = control(
  'repeat(?: that| it| the question| yourself)?|say (?:that|it) again|come again|again|' +
  'what did you say|(?:can|could) you (?:please )?repeat(?: that| it| the question)?|' +
  'pardon(?: me)?|what|huh');
const CANCEL = control(
  'stop(?: listening| talking)?|cancel(?: that)?|never ?mind(?: that)?|forget (?:it|that)|' +
  '(?:be )?quiet|shut up|abort');

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
// A mention preceded by one of these is a REJECTION ("not the first one").
const NEGATED = /\b(not|no|dont|never|instead of)( the)? $/;

export function matchOption(transcript, opts) {
  if (!opts.length) return null;
  const t = norm(transcript);

  // "unsure" answers must NOT be forced into a choice (e.g. "no idea" is not "no").
  if (/\b(no idea|not sure|dont know|do not know|no clue|unsure|cant decide|cannot decide|neither)\b/.test(t)) return null;

  // 1. an option label appears, un-negated, in the transcript (prefer the longest)
  let best = null;
  opts.forEach((o, i) => {
    const label = norm(o.label).trim();
    const at = label ? t.indexOf(' ' + label + ' ') : -1;
    if (at >= 0 && !NEGATED.test(t.slice(0, at + 1))) {
      if (!best || label.length > best.len) best = { index: i, label: o.label, by: 'label', len: label.length };
    }
  });
  if (best) { delete best.len; return best; }

  // 2. "option/number/choice N", an ordinal word (first/second/…), or a lone digit.
  // Deliberately NOT bare cardinals ("one"/"two") — "one" hides in "second one",
  // "someone", "the one". The reply matches only if exactly one option is picked.
  const picked = new Set();
  for (let i = 0; i < opts.length; i++) {
    const n = i + 1;
    for (const f of [`(?:option|number|choice) (?:${ORD[i]}|${ORDW[i]}|${n})`, ORDW[i], `${n}`]) {
      for (const m of t.matchAll(new RegExp(`\\b${f}\\b`, 'g'))) {
        if (!NEGATED.test(t.slice(0, m.index))) picked.add(i);
      }
    }
  }
  if (picked.size === 1) { const [i] = picked; return { index: i, label: opts[i].label, by: 'ordinal' }; }
  if (picked.size > 1) return null;

  // 3. yes/no for a two-choice question. A reply carrying BOTH ("no, I'm sure",
  // "don't do it") is not confident either way.
  if (opts.length === 2) {
    const yes = /\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|affirmative)\b/.test(t);
    const no = /\b(no|nope|nah|dont|do not|not|cancel|stop|skip|negative)\b/.test(t);
    if (yes && !no) return { index: 0, label: opts[0].label, by: 'affirm' };
    if (no && !yes) return { index: 1, label: opts[1].label, by: 'negate' };
  }
  return null;
}
