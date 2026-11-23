import { describe, expect, test } from "bun:test";
import {
  linkedTimestamps,
  nestComments,
  withoutReplyLink,
  type Comment,
  type CommentNode,
} from "./comments";

const CHANNEL = "C0CDSH7G760";
const link = (ts: string, channel = CHANNEL) =>
  `https://hackclub.slack.com/archives/${channel}/p${ts.replace(".", "")}?thread_ts=1.000001&cid=${channel}`;
const comment = (slackTs: string, text = "hello"): Comment => ({
  slackTs,
  userId: "U1",
  userName: "u1",
  text,
  formattedText: text,
  timestamp: new Date(Number(slackTs.split(".")[0]) * 1000).toISOString(),
});
const shape = (nodes: CommentNode[]): unknown[] =>
  nodes.map((n) =>
    n.replies.length
      ? [n.comment.slackTs, shape(n.replies)]
      : n.comment.slackTs,
  );

describe("links to comments", () => {
  test("a Slack message link names its timestamp, with or without the thread parameters", () => {
    expect(
      linkedTimestamps(
        comment("2.2", `see ${link("1700000001.000123")}`),
        CHANNEL,
      ),
    ).toEqual(["1700000001.000123"]);
    expect(
      linkedTimestamps(
        comment(
          "2.2",
          "<https://hackclub.slack.com/archives/C0CDSH7G760/p1700000001000123|this>",
        ),
        CHANNEL,
      ),
    ).toEqual(["1700000001.000123"]);
  });

  test("links to other channels, and other links, are not comment links", () => {
    expect(
      linkedTimestamps(
        comment("2.2", link("1700000001.000123", "C999")),
        CHANNEL,
      ),
    ).toEqual([]);
    expect(
      linkedTimestamps(
        comment("2.2", "https://example.com/archives/p1"),
        CHANNEL,
      ),
    ).toEqual([]);
  });
});

describe("nesting comments", () => {
  const a = "1700000001.000001";
  const b = "1700000002.000001";
  const c = "1700000003.000001";
  const d = "1700000004.000001";
  const e = "1700000005.000001";

  test("comments that link nothing stay in order at the top", () => {
    expect(
      shape(nestComments([comment(c), comment(a), comment(b)], CHANNEL)),
    ).toEqual([a, b, c]);
  });

  test("a comment linking an earlier one is nested under it", () => {
    const nested = nestComments(
      [comment(a), comment(b, `re ${link(a)}`), comment(c)],
      CHANNEL,
    );
    expect(shape(nested)).toEqual([[a, [b]], c]);
    expect(nested[0]!.replies[0]!.parent).toBe(nested[0]!);
  });

  test("replies to replies nest further, then stop at the depth limit", () => {
    const nested = nestComments(
      [
        comment(a),
        comment(b, link(a)),
        comment(c, link(b)),
        comment(d, link(c)),
        comment(e, link(d)),
      ],
      CHANNEL,
    );
    // a > b > c, and d and e sit beside c instead of going deeper.
    expect(shape(nested)).toEqual([[a, [[b, [c, d, e]]]]]);
    expect(nested[0]!.replies[0]!.replies.map((n) => n.depth)).toEqual([
      2, 2, 2,
    ]);
    // They still say which comment they answer.
    expect(nested[0]!.replies[0]!.replies[2]!.parent!.comment.slackTs).toBe(d);
  });

  test("a link to the card, a hidden comment, itself, or a later comment is ignored", () => {
    const cardLink = link("1699999999.000001");
    const nested = nestComments(
      [
        comment(a, `${cardLink} ${link(b)}`),
        comment(b, link(b)),
        comment(c, link("1700000009.000009")),
      ],
      CHANNEL,
    );
    expect(shape(nested)).toEqual([a, b, c]);
  });

  test("the first link that matches a shown earlier comment decides", () => {
    const nested = nestComments(
      [
        comment(a),
        comment(b),
        comment(c, `${link("1700000000.000000")} ${link(b)} ${link(a)}`),
      ],
      CHANNEL,
    );
    expect(shape(nested)).toEqual([a, [b, [c]]]);
  });
});

describe("the link that nested a comment", () => {
  const parent = "1700000001.000123";
  const url = `https://hackclub.slack.com/archives/${CHANNEL}/p1700000001000123?thread_ts=1.000001&cid=${CHANNEL}`;

  test("a bare link is dropped and the text tidied", () => {
    expect(withoutReplyLink(`Thanks! ${url} and more`, parent, CHANNEL)).toBe(
      "Thanks! and more",
    );
    expect(withoutReplyLink(`<${url}>`, parent, CHANNEL)).toBe("");
    expect(withoutReplyLink(`${url}\nSecond line`, parent, CHANNEL)).toBe(
      "Second line",
    );
  });

  test("a labelled link keeps its label", () => {
    expect(
      withoutReplyLink(
        `Agreed with <${url}|the first comment>`,
        parent,
        CHANNEL,
      ),
    ).toBe("Agreed with the first comment");
  });

  test("links to anything else are left alone", () => {
    const other = `https://hackclub.slack.com/archives/${CHANNEL}/p1700000009000009`;
    expect(
      withoutReplyLink(`see ${other} and https://example.com`, parent, CHANNEL),
    ).toBe(`see ${other} and https://example.com`);
    expect(
      withoutReplyLink(`<https://example.com|site>`, parent, CHANNEL),
    ).toBe("<https://example.com|site>");
  });
});
