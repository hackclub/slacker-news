/**
 * Tracked changes for suggesting mode. The editor shows the article with its
 * open suggestions drawn in: text a suggestion deletes stays visible, struck
 * through, and text it adds is marked. While the writer types, this module
 * turns each edit into changes of those marks, never of the article itself.
 *
 * The text is a list of segments. "keep" is the article as it stands. "del"
 * is article text a suggestion removes. "ins" is text a suggestion adds. The
 * article is the keep and del segments joined; what the box shows is all of
 * them joined. Free of DOM and EmDash types so it is tested on its own.
 */
import { anchorFor } from "./anchors";
import type { Anchor } from "./anchors";

export type Segment = {
  kind: "keep" | "del" | "ins";
  text: string;
  /** For del and ins: true when the current writer owns the suggestion and may change it. */
  mine?: boolean;
  /** For del and ins: the stored suggestion this belongs to, once it has one. */
  ref?: string;
};

export const mergedText = (segments: Segment[]) =>
  segments.map((s) => s.text).join("");

/** The article itself, which suggestions leave untouched. */
export const baseText = (segments: Segment[]) =>
  segments
    .filter((s) => s.kind !== "ins")
    .map((s) => s.text)
    .join("");

const same = (a: Segment, b: Segment) =>
  a.kind === b.kind &&
  (a.kind === "keep" || (a.mine === b.mine && a.ref === b.ref));

function normalize(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const last = out[out.length - 1];
    if (last && same(last, segment)) last.text += segment.text;
    else out.push({ ...segment });
  }
  return out;
}

/** An open suggestion placed in the article. */
export type Placed = {
  ref: string;
  start: number;
  end: number;
  replacement: string;
  mine: boolean;
};

/**
 * Draws suggestions into the article. Suggestions that overlap an earlier one
 * are left out of the text (they still show as cards).
 */
export function fromSuggestions(base: string, items: Placed[]): Segment[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const item of sorted) {
    if (item.start < cursor || item.end > base.length || item.end < item.start)
      continue;
    segments.push({ kind: "keep", text: base.slice(cursor, item.start) });
    if (item.end > item.start)
      segments.push({
        kind: "del",
        text: base.slice(item.start, item.end),
        mine: item.mine,
        ref: item.ref,
      });
    if (item.replacement)
      segments.push({
        kind: "ins",
        text: item.replacement,
        mine: item.mine,
        ref: item.ref,
      });
    cursor = item.end;
  }
  segments.push({ kind: "keep", text: base.slice(cursor) });
  return normalize(segments);
}

/** Cuts a segment list so a boundary falls at `position` of the joined text. */
function cutAt(segments: Segment[], position: number): Segment[] {
  const out: Segment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const end = offset + segment.text.length;
    if (position > offset && position < end) {
      out.push({ ...segment, text: segment.text.slice(0, position - offset) });
      out.push({ ...segment, text: segment.text.slice(position - offset) });
    } else out.push(segment);
    offset = end;
  }
  return out;
}

export type Edited = {
  segments: Segment[];
  /** Where a caret goes after text was typed: the end of what was inserted. */
  after: number;
  /** Where a caret goes after a backward delete: the start of the removed text. */
  before: number;
};

/**
 * Applies an edit to the shown text: `from`..`to` was replaced by `inserted`.
 * Article text in the range becomes struck through instead of leaving; text a
 * suggestion of the writer had added is removed for real. Returns undefined
 * when the edit would change another person's suggestion.
 */
export function applyEdit(
  segments: Segment[],
  from: number,
  to: number,
  inserted: string,
): Edited | undefined {
  // Refuse to edit inside, or across, a suggestion that is not the writer's.
  let offset = 0;
  for (const segment of segments) {
    const end = offset + segment.text.length;
    const foreign = segment.kind !== "keep" && !segment.mine;
    const touches =
      from === to ? from > offset && from < end : from < end && to > offset;
    if (foreign && touches) return undefined;
    offset = end;
  }

  const cut = cutAt(cutAt(segments, from), to);
  const before: Segment[] = [];
  const middle: Segment[] = [];
  const after: Segment[] = [];
  offset = 0;
  for (const segment of cut) {
    const end = offset + segment.text.length;
    if (end <= from) before.push(segment);
    else if (offset >= to) after.push(segment);
    else middle.push(segment);
    offset = end;
  }

  const struck: Segment[] = [];
  for (const segment of middle) {
    if (segment.kind === "keep")
      struck.push({ kind: "del", text: segment.text, mine: true });
    else if (segment.kind === "del") struck.push(segment);
    // Text the writer had added is simply gone.
  }
  const head = [...before, ...struck];
  const length = (list: Segment[]) =>
    list.reduce((n, s) => n + s.text.length, 0);

  let tail = after;
  if (inserted) {
    const last = head[head.length - 1];
    const next = tail[0];
    if (last && last.kind === "ins" && last.mine)
      head.push({ ...last, text: inserted });
    else if (next && next.kind === "ins" && next.mine)
      tail = [{ ...next, text: inserted + next.text }, ...tail.slice(1)];
    else head.push({ kind: "ins", text: inserted, mine: true });
  }

  const afterCaret = length(before) + length(struck) + inserted.length;
  return {
    segments: normalize([...head, ...tail]),
    after: afterCaret,
    before: from,
  };
}

/** The article position of a position in the shown text. */
export function toBase(segments: Segment[], position: number): number {
  let shown = 0;
  let base = 0;
  for (const segment of segments) {
    const end = shown + segment.text.length;
    if (
      position < end ||
      (position === end && segment === segments[segments.length - 1])
    ) {
      return segment.kind === "ins" ? base : base + (position - shown);
    }
    shown = end;
    if (segment.kind !== "ins") base += segment.text.length;
  }
  return base;
}

/**
 * The shown-text position of an article position. A start lands before the
 * character it points at; an end lands after the character before it.
 */
export function toShown(
  segments: Segment[],
  basePosition: number,
  side: "start" | "end",
): number {
  let shown = 0;
  let base = 0;
  for (const segment of segments) {
    if (segment.kind === "ins") {
      shown += segment.text.length;
      continue;
    }
    const end = base + segment.text.length;
    if (
      side === "start"
        ? basePosition < end
        : basePosition <= end && basePosition > base
    ) {
      return shown + (basePosition - base);
    }
    if (side === "end" && basePosition === base && base === 0) return shown;
    shown += segment.text.length;
    base = end;
  }
  return shown;
}

/** One change the writer made: article text removed and what replaces it. */
export type Change = Anchor & { replacement: string };

/**
 * The writer's own changes, as they are stored: each run of their marks that
 * touch is one suggestion, anchored in the article.
 */
export function changesOf(segments: Segment[]): Change[] {
  const base = baseText(segments);
  const changes: Change[] = [];
  let baseOffset = 0;
  let run: { start: number; quote: string; replacement: string } | null = null;
  const close = () => {
    if (!run) return;
    changes.push({
      ...anchorFor(base, run.start, run.start + run.quote.length),
      replacement: run.replacement,
    });
    run = null;
  };
  for (const segment of segments) {
    const mark = segment.kind !== "keep" && segment.mine;
    if (!mark) {
      close();
    } else {
      run ??= { start: baseOffset, quote: "", replacement: "" };
      if (segment.kind === "del") run.quote += segment.text;
      else run.replacement += segment.text;
    }
    if (segment.kind !== "ins") baseOffset += segment.text.length;
  }
  close();
  return changes;
}

/**
 * Works out what a text box edit was when the browser gave only the new text:
 * the span of the old text that is gone and the text that took its place.
 */
export function diffEdit(
  before: string,
  after: string,
): { from: number; to: number; inserted: string } {
  let from = 0;
  while (
    from < before.length &&
    from < after.length &&
    before[from] === after[from]
  )
    from++;
  let end = 0;
  while (
    end < before.length - from &&
    end < after.length - from &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return {
    from,
    to: before.length - end,
    inserted: after.slice(from, after.length - end),
  };
}
