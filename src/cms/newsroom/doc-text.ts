/**
 * The text of the rich-text editor's document, and the way back from a place
 * in that text to a place in the document.
 *
 * Comments and suggestions find their passage by its quoted text (see
 * anchors.ts), so they need the document as one string. Each paragraph,
 * heading or list item is a line; things that are not text, such as a video
 * block, add nothing. The same rule is used on the server for the review panel
 * (src/cms/rich/plain.ts), so line numbers agree.
 */

/** The parts of a ProseMirror node this reads. */
type NodeLike = {
  isText: boolean;
  isTextblock: boolean;
  text?: string | null;
};
type DocLike = {
  descendants(visit: (node: NodeLike, pos: number) => boolean | void): void;
};

/** A run of the text that sits at one place in the document. */
export type Run = { start: number; end: number; pos: number };

export type DocText = { text: string; runs: Run[] };

export function docText(doc: DocLike): DocText {
  let text = "";
  const runs: Run[] = [];
  let first = true;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!first) text += "\n";
      first = false;
      return true;
    }
    if (node.isText) {
      const own = node.text ?? "";
      runs.push({ start: text.length, end: text.length + own.length, pos });
      text += own;
      return false;
    }
    return true;
  });
  return { text, runs };
}

/** Where a passage that begins at this offset begins in the document. */
export function startPos(dt: DocText, offset: number): number | undefined {
  for (const run of dt.runs) {
    if (offset >= run.start && offset < run.end)
      return run.pos + (offset - run.start);
  }
  // At the very end of the text.
  const last = dt.runs[dt.runs.length - 1];
  return last && offset === last.end
    ? last.pos + (last.end - last.start)
    : undefined;
}

/** Where a passage that ends at this offset ends in the document. */
export function endPos(dt: DocText, offset: number): number | undefined {
  for (const run of dt.runs) {
    if (offset > run.start && offset <= run.end)
      return run.pos + (offset - run.start);
  }
  // An empty passage at the start of a run.
  const run = dt.runs.find((r) => offset === r.start);
  return run?.pos;
}

/** The offset in the text of a place in the document. */
export function offsetAt(dt: DocText, pos: number): number {
  for (const run of dt.runs) {
    const length = run.end - run.start;
    if (pos >= run.pos && pos <= run.pos + length)
      return run.start + (pos - run.pos);
    // Between runs: the start of the next one.
    if (pos < run.pos) return run.start;
  }
  return dt.text.length;
}
