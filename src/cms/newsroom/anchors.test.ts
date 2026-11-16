import { describe, expect, test } from "bun:test";
import {
  anchorFor,
  applyReplacement,
  findAnchor,
  marksAt,
  pieces,
} from "./anchors";

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
    expect(applyReplacement("Nothing alike.", anchor, "x")).toBeUndefined();
  });

  test("applies a replacement to the right occurrence", () => {
    const start = text.lastIndexOf("cat");
    const anchor = anchorFor(text, start, start + 3);
    expect(applyReplacement(text, anchor, "fox")).toBe(
      "The cat sat. The fox ran. A dog ran.",
    );
  });

  test("an empty replacement deletes the passage", () => {
    const anchor = anchorFor(text, 13, 17);
    expect(applyReplacement(text, anchor, "")).toBe(
      "The cat sat. cat ran. A dog ran.",
    );
  });

  test("cuts text into stretches with their marks", () => {
    const out = pieces("abcdef", [
      { id: "a", start: 1, end: 4 },
      { id: "b", start: 3, end: 5 },
    ]);
    expect(out).toEqual([
      { text: "a", ids: [] },
      { text: "bc", ids: ["a"] },
      { text: "d", ids: ["a", "b"] },
      { text: "e", ids: ["b"] },
      { text: "f", ids: [] },
    ]);
    expect(out.map((p) => p.text).join("")).toBe("abcdef");
  });

  test("lists the marks at a caret", () => {
    const ranges = [
      { id: "a", start: 1, end: 4 },
      { id: "b", start: 3, end: 5 },
    ];
    expect(marksAt(ranges, 2)).toEqual(["a"]);
    expect(marksAt(ranges, 3)).toEqual(["a", "b"]);
    expect(marksAt(ranges, 9)).toEqual([]);
  });
});
