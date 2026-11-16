import { describe, expect, test } from "bun:test";
import {
  applyEdit,
  baseText,
  changesOf,
  diffEdit,
  fromSuggestions,
  mergedText,
  toBase,
  toShown,
  type Segment,
} from "./tracking";

const base = "The cat sat on the mat.";
const plain = (): Segment[] => [{ kind: "keep", text: base }];

function edit(segments: Segment[], from: number, to: number, inserted: string) {
  const result = applyEdit(segments, from, to, inserted);
  if (!result) throw new Error("refused");
  return result.segments;
}

describe("tracked edits", () => {
  test("typing adds a mark and leaves the article alone", () => {
    const out = edit(plain(), 4, 4, "big ");
    expect(mergedText(out)).toBe("The big cat sat on the mat.");
    expect(baseText(out)).toBe(base);
    expect(changesOf(out)).toMatchObject([
      { quote: "", replacement: "big ", start: 4 },
    ]);
  });

  test("deleting strikes text through instead of removing it", () => {
    const out = edit(plain(), 4, 8, "");
    expect(mergedText(out)).toBe(base);
    expect(out.map((s) => s.kind)).toEqual(["keep", "del", "keep"]);
    expect(changesOf(out)).toMatchObject([{ quote: "cat ", replacement: "" }]);
  });

  test("replacing a selection strikes the old text and adds the new", () => {
    const out = edit(plain(), 4, 7, "dog");
    expect(mergedText(out)).toBe("The catdog sat on the mat.");
    expect(baseText(out)).toBe(base);
    expect(changesOf(out)).toMatchObject([
      { quote: "cat", replacement: "dog", start: 4 },
    ]);
  });

  test("keeps typing into the same addition", () => {
    let out = edit(plain(), 4, 4, "b");
    out = edit(out, 5, 5, "ig");
    expect(out.filter((s) => s.kind === "ins")).toEqual([
      { kind: "ins", text: "big", mine: true },
    ]);
  });

  test("deleting text the writer added removes it for real", () => {
    let out = edit(plain(), 4, 4, "big ");
    out = edit(out, 4, 8, "");
    expect(out).toEqual(plain());
    expect(changesOf(out)).toEqual([]);
  });

  test("deleting already struck text changes nothing", () => {
    const struck = edit(plain(), 4, 8, "");
    const again = edit(struck, 4, 8, "");
    expect(again).toEqual(struck);
  });

  test("a replacement across a struck span still reads back as one change", () => {
    let out = edit(plain(), 4, 7, "dog");
    out = edit(out, 7, 10, "");
    expect(baseText(out)).toBe(base);
    const [change] = changesOf(out);
    expect(change.replacement).toBe("");
    expect(changesOf(out).length).toBe(1);
  });

  test("changes far apart are separate suggestions", () => {
    let out = edit(plain(), 0, 3, "A");
    out = edit(
      out,
      mergedText(out).length - 1,
      mergedText(out).length - 1,
      "!",
    );
    expect(changesOf(out).length).toBe(2);
    expect(baseText(out)).toBe(base);
  });

  test("an edit in someone else's suggestion is refused", () => {
    const theirs = fromSuggestions(base, [
      { ref: "x", start: 4, end: 7, replacement: "dog", mine: false },
    ]);
    expect(applyEdit(theirs, 5, 5, "z")).toBeUndefined();
    expect(applyEdit(theirs, 3, 6, "")).toBeUndefined();
    // Beside it is fine.
    expect(applyEdit(theirs, 0, 0, "Oh. ")).toBeDefined();
  });

  test("their marks are not part of the writer's changes", () => {
    const theirs = fromSuggestions(base, [
      { ref: "x", start: 4, end: 7, replacement: "dog", mine: false },
    ]);
    expect(changesOf(theirs)).toEqual([]);
  });
});

describe("drawing suggestions in", () => {
  test("shows deletions and additions in place", () => {
    const out = fromSuggestions(base, [
      { ref: "a", start: 4, end: 7, replacement: "dog", mine: true },
    ]);
    expect(out.map((s) => `${s.kind}:${s.text}`)).toEqual([
      "keep:The ",
      "del:cat",
      "ins:dog",
      "keep: sat on the mat.",
    ]);
    expect(baseText(out)).toBe(base);
  });

  test("a suggestion that overlaps an earlier one is left out", () => {
    const out = fromSuggestions(base, [
      { ref: "a", start: 4, end: 10, replacement: "x", mine: true },
      { ref: "b", start: 6, end: 8, replacement: "y", mine: true },
    ]);
    expect(baseText(out)).toBe(base);
    expect(out.filter((s) => s.ref === "b")).toEqual([]);
  });

  test("storing and drawing again gives the same text", () => {
    let out = edit(plain(), 4, 7, "dog");
    out = edit(out, mergedText(out).length, mergedText(out).length, " Yes.");
    const stored = changesOf(out).map((c, i) => ({
      ref: String(i),
      start: c.start,
      end: c.start + c.quote.length,
      replacement: c.replacement,
      mine: true,
    }));
    const redrawn = fromSuggestions(base, stored);
    expect(mergedText(redrawn)).toBe(mergedText(out));
  });
});

describe("positions", () => {
  const segs = fromSuggestions(base, [
    { ref: "a", start: 4, end: 7, replacement: "dog", mine: true },
  ]);
  // shown: "The catdog sat on the mat."

  test("maps shown positions to the article", () => {
    expect(toBase(segs, 2)).toBe(2);
    expect(toBase(segs, 5)).toBe(5);
    expect(toBase(segs, 8)).toBe(7); // inside the addition
    expect(toBase(segs, 12)).toBe(9);
  });

  test("maps article positions to shown positions", () => {
    expect(toShown(segs, 0, "start")).toBe(0);
    expect(toShown(segs, 8, "start")).toBe(11);
    expect(toShown(segs, 7, "end")).toBe(7);
    expect(toShown(segs, 23, "end")).toBe(mergedText(segs).length);
  });
});

describe("working out an edit from new text", () => {
  test("typing", () => {
    expect(diffEdit("abc", "abXc")).toEqual({ from: 2, to: 2, inserted: "X" });
  });
  test("deleting", () => {
    expect(diffEdit("abcd", "ad")).toEqual({ from: 1, to: 3, inserted: "" });
  });
  test("replacing", () => {
    expect(diffEdit("abcd", "aXd")).toEqual({ from: 1, to: 3, inserted: "X" });
  });
});
