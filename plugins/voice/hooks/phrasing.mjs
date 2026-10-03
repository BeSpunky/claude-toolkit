// bespunky-voice — phrasing.mjs
//
// How a question is SAID when Claude didn't write the spoken form itself: the
// question, then its choices as one natural spoken list — "Which approach: commit
// now, keep going, or stash it?". Never a form read aloud: no "Claude asks", no
// "option one", no "say your choice", and choices the question already names are
// not said twice. Shared by both auto-speak paths (the AskUserQuestion picker and
// a prose question that ends a turn), so they can't drift into two voices.

const RECOMMENDED = /\s*\((?:recommended|suggested)\)\s*/i;
const YES_NO = /^(yes|no|yeah|nope|sure|ok|okay|not now|cancel)\b/i;
const norm = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// "a", "a or b", "a, b, or c" — `and` for a pick-any question. Two LONG choices
// get the comma too: it is where a speaker breathes, and the voice pauses on it.
const spokenList = (items, joiner = 'or') => {
  const long = items.some((i) => i.split(/\s+/).length > 4);
  if (items.length === 2) return items.join(long ? `, ${joiner} ` : ` ${joiner} `);
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')}, ${joiner} ${items[items.length - 1]}`;
};

// A label as a phrase inside a sentence: no "(Recommended)", no code ticks, no
// closing punctuation of its own ("…retry the request. or …" is how that sounds).
const asPhrase = (label) => label.replace(RECOMMENDED, ' ').replace(/`/g, '').trim().replace(/[.!?;:,]+$/, '').trim();

/**
 * @param {string} question
 * @param {Array<string|{label:string}>} options
 * @param {{ multiSelect?: boolean }} [how]
 */
export function phraseQuestion(question, options, { multiSelect = false } = {}) {
  const q = String(question || '').trim();
  const labels = (Array.isArray(options) ? options : [])
    .map((o) => (o && typeof o === 'object' ? o.label : o))
    .filter((l) => typeof l === 'string' && l.trim())
    .map((l) => l.trim());
  if (!labels.length) return q;

  const plain = labels.map(asPhrase);
  const pick = labels.findIndex((l) => RECOMMENDED.test(l));
  const qn = ' ' + norm(q) + ' ';
  const alreadyNamed = plain.every((l) => qn.includes(' ' + norm(l) + ' '));
  // A yes/no question is asked as one — "Should I commit?", not "…: yes or no?".
  const yesNo = plain.length <= 2 && plain.every((l) => YES_NO.test(l));

  let said = q;
  if (multiSelect) {
    said = `${q.replace(/[?.!:]*$/, '')}: ${spokenList(plain, 'and')}? Pick any.`;
  } else if (!alreadyNamed && !(yesNo && q)) {
    said = q ? `${q.replace(/[?.!:]*$/, '')}: ${spokenList(plain)}?` : `${spokenList(plain)}?`;
  }
  if (pick >= 0) said += yesNo ? ` I'd say ${plain[pick].toLowerCase()}.` : ` I'd go with ${plain[pick]}.`;
  return said;
}

// Cap what is said: a wall of words is unpleasant to hear AND a very long argv
// could hit ARG_MAX. Trim on a word boundary — unless an unbroken token would
// collapse the text.
export function capSpoken(text, cap = 1000) {
  if (text.length <= cap) return text;
  const cut = text.slice(0, cap);
  const onWord = cut.replace(/\s+\S*$/, '');
  return (onWord.length > cap * 0.6 ? onWord : cut) + '…';
}
