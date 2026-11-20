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

  test("a link to a Slack person or channel is a mention, inside the sentence", () => {
    const block: PortableBlock = {
      _type: "block",
      style: "normal",
      markDefs: [
        {
          _key: "u",
          _type: "link",
          href: "https://hackclub.slack.com/team/U09Q8MLTE58",
        },
        {
          _key: "c",
          _type: "link",
          href: "https://hackclub.slack.com/archives/C0ALDCF90K1",
        },
        { _key: "x", _type: "link", href: "https://hackclub.slack.com/help" },
      ],
      children: [
        { _type: "span", text: "Ask " },
        { _type: "span", text: "@eps", marks: ["u"] },
        { _type: "span", text: " in " },
        { _type: "span", text: "#slacker-news", marks: ["c", "strong"] },
        { _type: "span", text: " or " },
        { _type: "span", text: "read this", marks: ["x"] },
        { _type: "span", text: "." },
      ],
    };
    expect(portableTextToMdx([block])).toBe(
      'Ask <SlackMention id={"U09Q8MLTE58"} name={"eps"} /> in ' +
        '<SlackChannel id={"C0ALDCF90K1"} label={"slacker-news"} /> or ' +
        "[read this](https://hackclub.slack.com/help).\n",
    );
  });

  test("text cannot become code: import and export at the start of a paragraph", () => {
    const out = portableTextToMdx([
      p("import fs from 'fs'"),
      p("export const x = 1"),
      p("  export default y"),
      p("important news"),
    ]);
    expect(out).toBe(
      "&#105;mport fs from 'fs'\n\n&#101;xport const x = 1\n\n  &#101;xport default y\n\nimportant news\n",
    );
  });

  test("links that would run script are dropped; odd characters are encoded", () => {
    const link = (href: string): PortableBlock => ({
      _type: "block",
      style: "normal",
      markDefs: [{ _key: "a", _type: "link", href }],
      children: [{ _type: "span", text: "x", marks: ["a"] }],
    });
    expect(portableTextToMdx([link("javascript:alert(1)")])).toBe("x\n");
    expect(portableTextToMdx([link("data:text/html,hi")])).toBe("x\n");
    expect(portableTextToMdx([link("//evil.test/a")])).toBe("x\n");
    expect(portableTextToMdx([link("https://x.test/a{b}<c>")])).toBe(
      "[x](https://x.test/a%7Bb%7D%3Cc%3E)\n",
    );
    expect(portableTextToMdx([link("/news/a")])).toBe("[x](/news/a)\n");
  });

  test("code cannot close its own fence, and the language is plain", () => {
    expect(
      portableTextToMdx([
        { _type: "code", code: "a\n````\nb", language: "js}\n<x" },
      ]),
    ).toBe("`````jsx\na\n````\nb\n`````\n");
  });

  test("emoji and formulas typed in a sentence become components", () => {
    expect(portableTextToMdx([p("Shipped :tada: at $$x^2$$ speed")])).toBe(
      'Shipped <Emoji name={"tada"} /> at <M d={"x^2"} /> speed\n',
    );
    // A time, a word with colons and a lone dollar stay text.
    expect(portableTextToMdx([p("At 10:30:00, re:this:that costs $5")])).toBe(
      "At 10:30:00, re:this:that costs \\$5\n",
    );
  });

  test("a formula or emoji cannot become code", () => {
    expect(portableTextToMdx([p('$$"} /><script>x</script>{"$$ :a"b:')])).toBe(
      '<M d={"\\"} /><script>x</script>{\\""} /> :a"b:\n',
    );
  });
});
