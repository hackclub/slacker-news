import type { IndigestMessage } from "./indigest";

// Edition numbers for newsletter-style Slack columns (editionNumbers in
// slack-columns.json). Each edition usually says its own number, e.g.
// "(Twenty-First Edition - ...)", "(Edition #33 ...)" or "(101st edition)",
// so the number is read from the text rather than counted: channels also hold
// short announcement pings that are not editions, and a count would drift.

const ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const ONES_ORDINAL = [
  "",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
const TENS_ORDINAL = [
  "",
  "",
  "twentieth",
  "thirtieth",
  "fortieth",
  "fiftieth",
  "sixtieth",
  "seventieth",
  "eightieth",
  "ninetieth",
];

// "sixty-first", "sixty-eight", "tenth", "two": 1 to 99, ordinal or not.
const NUMBER_WORDS = new Map<string, number>();
for (let n = 1; n < 100; n++) {
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (n < 20) {
    NUMBER_WORDS.set(ONES[n]!, n);
    NUMBER_WORDS.set(ONES_ORDINAL[n]!, n);
  } else if (ones === 0) {
    NUMBER_WORDS.set(TENS[tens]!, n);
    NUMBER_WORDS.set(TENS_ORDINAL[tens]!, n);
  } else {
    NUMBER_WORDS.set(`${TENS[tens]}-${ONES[ones]}`, n);
    NUMBER_WORDS.set(`${TENS[tens]}-${ONES_ORDINAL[ones]}`, n);
  }
}

const EDITION_PATTERNS = [
  // "101st edition", "(Edition #33", "issue #32"
  /\b(\d{1,4})(?:st|nd|rd|th)\s+edition\b/gi,
  /\b(?:edition|issue)\s*#\s*(\d{1,4})\b/gi,
  // "Twenty-First Edition", "sixty-eight edition", "edition two"
  /\b([a-z]+(?:-[a-z]+)?)\s+edition\b/gi,
  /\bedition\s+([a-z]+(?:-[a-z]+)?)\b/gi,
];

/** The edition number a message's text names, if any. The last one wins: it is usually the sign-off. */
export function statedEdition(text: string): number | undefined {
  let found: { index: number; value: number } | undefined;
  for (const pattern of EDITION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1]!.toLowerCase();
      const value = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS.get(raw);
      if (value && (!found || match.index! > found.index)) {
        found = { index: match.index!, value };
      }
    }
  }
  return found?.value;
}

/**
 * Edition numbers by message timestamp. A stated number only counts when it is
 * higher than the edition before it, which drops slips like "the first edition
 * of 2025" or a repeated number. A message without one gets a number when the
 * gap between its numbered neighbours fits the messages in it exactly, so a
 * lone unnumbered edition is filled in but announcement pings are not.
 */
export function editionNumbers(
  messages: IndigestMessage[],
): Map<string, number> {
  const sorted = [...messages].sort(
    (a, b) => Number(a.slackTs) - Number(b.slackTs),
  );
  const editions: (number | undefined)[] = [];
  let previous = 0;
  for (const message of sorted) {
    const stated = statedEdition(message.text);
    const edition =
      stated !== undefined && stated > previous ? stated : undefined;
    if (edition !== undefined) previous = edition;
    editions.push(edition);
  }

  let last = -1;
  for (let i = 0; i < editions.length; i++) {
    if (editions[i] === undefined) continue;
    if (last >= 0 && editions[i]! - editions[last]! === i - last) {
      for (let j = last + 1; j < i; j++)
        editions[j] = editions[last]! + (j - last);
    }
    last = i;
  }

  const numbers = new Map<string, number>();
  sorted.forEach((message, i) => {
    if (editions[i] !== undefined) numbers.set(message.slackTs, editions[i]!);
  });
  return numbers;
}
