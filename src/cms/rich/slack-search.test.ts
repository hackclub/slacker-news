import { describe, expect, test } from "bun:test";
import { readHits, searchUrl } from "./slack-search";

describe("slack search", () => {
  test("builds a search address with the query escaped", () => {
    expect(searchUrl("users", "a b&c")).toBe(
      "https://flaron.halceon.dev/users/search?q=a%20b%26c",
    );
  });

  test("reads people, with their real name as detail", () => {
    expect(
      readHits("users", {
        data: [
          { id: "U1", name: "eps", real_name: "Evan Streams" },
          { id: "U2", name: "same", real_name: "same" },
          { name: "no-id" },
        ],
      }),
    ).toEqual([
      { id: "U1", name: "eps", detail: "Evan Streams" },
      { id: "U2", name: "same" },
    ]);
  });

  test("reads channels and caps the count", () => {
    const data = Array.from({ length: 30 }, (_, i) => ({
      id: `C${i}`,
      name: `c${i}`,
    }));
    expect(readHits("channels", { data }, 5)).toHaveLength(5);
  });

  test("anything else is no hits", () => {
    expect(readHits("users", null)).toEqual([]);
    expect(readHits("users", { error: "x" })).toEqual([]);
  });
});
