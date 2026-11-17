import { describe, expect, test } from "bun:test";
import { docText, endPos, offsetAt, startPos } from "./doc-text";

// A document of two paragraphs, "Hello world" and "Second", with a video block
// between them, as ProseMirror would number it: each paragraph is 1 token to
// open, its text, and 1 to close.
function fake() {
  const nodes = [
    { node: { isText: false, isTextblock: true }, pos: 0 },
    { node: { isText: true, isTextblock: false, text: "Hello " }, pos: 1 },
    { node: { isText: true, isTextblock: false, text: "world" }, pos: 7 },
    { node: { isText: false, isTextblock: false }, pos: 13 },
    { node: { isText: false, isTextblock: true }, pos: 14 },
    { node: { isText: true, isTextblock: false, text: "Second" }, pos: 15 },
  ];
  return {
    descendants(visit: (node: never, pos: number) => boolean | void) {
      for (const { node, pos } of nodes) visit(node as never, pos);
    },
  };
}

describe("docText", () => {
  const dt = docText(fake() as never);

  test("paragraphs are lines; blocks that are not text add nothing", () => {
    expect(dt.text).toBe("Hello world\nSecond");
  });

  test("a passage maps to document positions, across runs", () => {
    // "lo wor" is offsets 3 to 9.
    expect(startPos(dt, 3)).toBe(4);
    expect(endPos(dt, 9)).toBe(10);
    // "Second" starts after the newline.
    expect(startPos(dt, 12)).toBe(15);
    expect(endPos(dt, 18)).toBe(21);
  });

  test("a place in the document maps back to an offset", () => {
    expect(offsetAt(dt, 4)).toBe(3);
    expect(offsetAt(dt, 21)).toBe(18);
    // In the video block: the start of what follows.
    expect(offsetAt(dt, 13)).toBe(12);
  });

  test("a place with no text is not found", () => {
    expect(startPos(dt, 99)).toBeUndefined();
  });
});
