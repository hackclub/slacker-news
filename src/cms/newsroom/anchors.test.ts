import { describe, expect, test } from "bun:test";
import { anchorFor, findAnchor } from "./anchors";

const text = "The cat sat. The cat ran. A dog ran.";

describe("anchors", () => {
  test("finds a passage where it was made", () => {
    const start = text.indexOf("cat ran");
    const anchor = anchorFor(text, start, start + 7);
    expect(findAnchor(text, anchor)).toEqual({ start, end: start + 7 });
  });

  test("tells repeated passages apart by their surroundings", () => {
    const start = text.lastIndexOf("cat");
    const anchor = anchorFor(text, start, start + 3);
    const moved = "Intro added here. " + text;
    expect(findAnchor(moved, anchor)?.start).toBe(moved.lastIndexOf("cat"));
  });

  test("follows a passage when text above it changed", () => {
    const start = text.indexOf("dog");
    const anchor = anchorFor(text, start, start + 3);
    const edited = "Lots of new words. " + text;
    expect(findAnchor(edited, anchor)?.start).toBe(edited.indexOf("dog"));
  });

  test("gives up when the passage was edited away", () => {
    const anchor = anchorFor(text, 0, 7);
    expect(findAnchor("Nothing alike.", anchor)).toBeUndefined();
  });
});

describe("anchors without a quoted passage", () => {
  const text = "The cat sat. The cat ran. A dog ran.";

  test("finds an insertion point where it was made", () => {
    const at = text.indexOf("A dog");
    const anchor = anchorFor(text, at, at);
    expect(findAnchor(text, anchor)).toEqual({ start: at, end: at });
  });

  test("follows an insertion point when text above it changed", () => {
    const at = text.indexOf("A dog");
    const anchor = anchorFor(text, at, at);
    const edited = "New opening. " + text;
    const found = findAnchor(edited, anchor);
    expect(found?.start).toBe(edited.indexOf("A dog"));
  });

  test("gives up when the words around it are gone", () => {
    const anchor = anchorFor(text, 13, 13);
    expect(
      findAnchor("Entirely different words here.", anchor),
    ).toBeUndefined();
  });
});
