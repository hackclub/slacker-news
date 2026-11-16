/**
 * Where a comment or suggestion sits in an article's text. An anchor keeps the
 * quoted passage and a little text around it, so it can be found again after
 * the text above it changed. Free of EmDash and DOM types, so it is tested on
 * its own and shared by the server and the editor.
 */

/** How much text on each side of a passage an anchor keeps. */
export const CONTEXT = 32;

export type Anchor = {
  quote: string;
  prefix: string;
  suffix: string;
  /** Where the passage began when the anchor was made; a hint, not a promise. */
  start: number;
};

export type Range = { start: number; end: number };

/** Makes an anchor for the passage at `start`..`end` of `text`. */
export function anchorFor(text: string, start: number, end: number): Anchor {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    start,
  };
}

/** How many characters of `a` and `b` agree, counting back from their ends. */
function commonTail(a: string, b: string) {
  let n = 0;
  while (
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  )
    n++;
  return n;
}

/** How many characters of `a` and `b` agree from their starts. */
function commonHead(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Finds an anchor's passage in the current text. When the passage occurs
 * more than once, the occurrence whose surroundings match best wins, and then
 * the one nearest where it used to be. Returns undefined when the passage was
 * edited away.
 */
export function findAnchor(text: string, anchor: Anchor): Range | undefined {
  const { quote } = anchor;
  if (!quote) return findPoint(text, anchor);
  let best: (Range & { score: number; distance: number }) | undefined;
  for (
    let at = text.indexOf(quote);
    at >= 0;
    at = text.indexOf(quote, at + 1)
  ) {
    const end = at + quote.length;
    const score =
      commonTail(text.slice(Math.max(0, at - CONTEXT), at), anchor.prefix) +
      commonHead(text.slice(end, end + CONTEXT), anchor.suffix);
    const distance = Math.abs(at - anchor.start);
    if (
      !best ||
      score > best.score ||
      (score === best.score && distance < best.distance)
    )
      best = { start: at, end, score, distance };
  }
  return best && { start: best.start, end: best.end };
}

/**
 * Finds the place of an anchor with no quoted passage, such as an insertion:
 * the position whose surrounding text matches best. Returns undefined when
 * the words around it were edited too much to be sure.
 */
function findPoint(text: string, anchor: Anchor): Range | undefined {
  const { prefix, suffix } = anchor;
  const needle = (value: string, from: "start" | "end") =>
    from === "end" ? value.slice(-12) : value.slice(0, 12);
  const candidates = new Set<number>();
  if (prefix) {
    const key = needle(prefix, "end");
    for (let at = text.indexOf(key); at >= 0; at = text.indexOf(key, at + 1))
      candidates.add(at + key.length);
  }
  if (suffix) {
    const key = needle(suffix, "start");
    for (let at = text.indexOf(key); at >= 0; at = text.indexOf(key, at + 1))
      candidates.add(at);
  }
  if (!prefix && !suffix) candidates.add(0);
  let best: { at: number; score: number; distance: number } | undefined;
  for (const at of candidates) {
    const score =
      commonTail(text.slice(Math.max(0, at - CONTEXT), at), prefix) +
      commonHead(text.slice(at, at + CONTEXT), suffix);
    const distance = Math.abs(at - anchor.start);
    if (
      !best ||
      score > best.score ||
      (score === best.score && distance < best.distance)
    )
      best = { at, score, distance };
  }
  const needed = Math.min(8, prefix.length + suffix.length);
  if (!best || best.score < needed) return undefined;
  return { start: best.at, end: best.at };
}

/** The text with a suggestion applied, or undefined when its passage is gone. */
export function applyReplacement(
  text: string,
  anchor: Anchor,
  replacement: string,
): string | undefined {
  const found = findAnchor(text, anchor);
  if (!found) return undefined;
  return text.slice(0, found.start) + replacement + text.slice(found.end);
}

/** A stretch of text and the marks that cover it. */
export type Piece = { text: string; ids: string[] };

/**
 * Cuts text into stretches by where marked ranges begin and end, so the
 * editor can draw each stretch with its highlights. Ranges may overlap.
 */
export function pieces(
  text: string,
  ranges: (Range & { id: string })[],
): Piece[] {
  const cuts = new Set([0, text.length]);
  for (const range of ranges) {
    cuts.add(Math.max(0, Math.min(text.length, range.start)));
    cuts.add(Math.max(0, Math.min(text.length, range.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Piece[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (from === to) continue;
    out.push({
      text: text.slice(from, to),
      ids: ranges
        .filter((r) => r.start <= from && r.end >= to)
        .map((r) => r.id),
    });
  }
  return out;
}

/** The marks whose range holds a caret position. */
export function marksAt(
  ranges: (Range & { id: string })[],
  position: number,
): string[] {
  return ranges
    .filter((r) => position >= r.start && position <= r.end)
    .map((r) => r.id);
}
