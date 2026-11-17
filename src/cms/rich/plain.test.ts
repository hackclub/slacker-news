import { describe, expect, test } from "bun:test";
import { portableTextToPlain } from "./plain";

describe("portableTextToPlain", () => {
  test("a line for each text block; other blocks add nothing", () => {
    expect(
      portableTextToPlain([
        { _type: "block", children: [{ text: "Hello " }, { text: "world" }] },
        { _type: "snYouTube", id: "x" },
        { _type: "block", children: [] },
        { _type: "code", code: "a = 1" },
      ]),
    ).toBe("Hello world\n\na = 1");
  });

  test("anything else is empty", () => {
    expect(portableTextToPlain(undefined)).toBe("");
  });
});
