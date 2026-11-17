import { describe, expect, test } from "bun:test";
import { portableTextToMdx, type PortableBlock } from "./to-mdx";

const p = (
  text: string,
  extra: Partial<PortableBlock> = {},
): PortableBlock => ({
  _type: "block",
  style: "normal",
  children: [{ _type: "span", text }],
  ...extra,
});

describe("portableTextToMdx", () => {
  test("paragraphs and headings", () => {
    expect(
      portableTextToMdx([p("Title", { style: "h2" }), p("One."), p("Two.")]),
    ).toBe("## Title\n\nOne.\n\nTwo.\n");
  });

  test("marks nest and keep spaces outside the markers", () => {
    const block: PortableBlock = {
      _type: "block",
      style: "normal",
      markDefs: [{ _key: "a", _type: "link", href: "https://x.test/a b" }],
      children: [
        { _type: "span", text: "a " },
        { _type: "span", text: "bold ", marks: ["strong"] },
        { _type: "span", text: "both", marks: ["strong", "em"] },
        { _type: "span", text: " link", marks: ["a"] },
        { _type: "span", text: "x < y", marks: ["code"] },
      ],
    };
    expect(portableTextToMdx([block])).toBe(
      "a **bold** _**both**_ [link](https://x.test/a%20b)`x < y`\n",
    );
  });

  test("text that looks like markdown or MDX is escaped", () => {
    expect(portableTextToMdx([p("1 < 2 {x} *y* # z")])).toBe(
      "1 \\< 2 \\{x\\} \\*y\\* \\# z\n",
    );
  });

  test("lists, numbered and nested", () => {
    const out = portableTextToMdx([
      p("a", { listItem: "bullet", level: 1 }),
      p("b", { listItem: "bullet", level: 2 }),
      p("after"),
      p("one", { listItem: "number", level: 1 }),
      p("two", { listItem: "number", level: 1 }),
    ]);
    expect(out).toBe("- a\n  - b\n\nafter\n\n1. one\n2. two\n");
  });

  test("blockquote, rule and code", () => {
    expect(
      portableTextToMdx([
        p("quoted", { style: "blockquote" }),
        { _type: "break" },
        { _type: "code", code: "let a = 1;", language: "js" },
      ]),
    ).toBe("> quoted\n\n---\n\n```js\nlet a = 1;\n```\n");
  });

  test("components become their MDX tags", () => {
    expect(
      portableTextToMdx([
        { _type: "snYouTube", id: "abc", title: 'He said "hi"' },
        { _type: "snSlackMention", id: "U1", name: "eps" },
        { _type: "snCaption", text: "A *caption*" },
        { _type: "snMath", d: "x^2" },
      ]),
    ).toBe(
      '<YouTube id={"abc"} title={"He said \\"hi\\""} />\n\n' +
        '<SlackMention id={"U1"} name={"eps"} />\n\n' +
        "<Caption>A \\*caption\\*</Caption>\n\n" +
        '<M d={"x^2"} />\n',
    );
  });

  test("empty optional fields are left out; unknown blocks are skipped", () => {
    expect(
      portableTextToMdx([
        { _type: "snYouTube", id: "abc", title: "t", caption: "" },
        { _type: "somethingElse" },
        null,
      ]),
    ).toBe('<YouTube id={"abc"} title={"t"} />\n');
  });

  test("not an array is empty", () => {
    expect(portableTextToMdx(undefined)).toBe("");
    expect(portableTextToMdx([])).toBe("");
  });
});
