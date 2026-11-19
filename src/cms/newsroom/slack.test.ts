import { describe, expect, test } from "bun:test";
import { escape, link, mention, post, quote, say } from "./slack";

const article = { title: "Stardance <wraps> & up", url: "https://x.test/a|b" };

describe("text", () => {
  test("markup in a title is escaped", () => {
    expect(escape("a <b> & c")).toBe("a &lt;b&gt; &amp; c");
    expect(link(article.url, article.title)).toBe(
      "<https://x.test/a%7Cb|Stardance &lt;wraps&gt; &amp; up>",
    );
  });

  test("a mention needs a Slack ID, and a name cannot fake one", () => {
    expect(mention("Ada", "U012ABCDEF")).toBe("<@U012ABCDEF>");
    expect(mention("Ada")).toBe("Ada");
    expect(mention("<!channel>", "not an id")).toBe("&lt;!channel&gt;");
  });

  test("a quoted note is one line, cut short", () => {
    expect(quote("")).toBe("");
    expect(quote("one\ntwo")).toBe("\n>one two");
    expect(quote("x".repeat(50), 10)).toBe(`\n>${"x".repeat(9)}…`);
  });

  test("events name the article and the person", () => {
    const text = say.changesRequested(
      article,
      { name: "Ed", slackId: "U0EDITOR00" },
      "Tighten the lede",
    );
    expect(text).toContain("<@U0EDITOR00> asked for changes on <https://");
    expect(text).toEndWith("\n>Tighten the lede");
  });
});

describe("post", () => {
  const answer = (body: unknown) => async () => Response.json(body);

  test("sends to a thread and reports where it landed", async () => {
    let sent: Record<string, unknown> = {};
    const fetcher = async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer t");
      return Response.json({ ok: true, channel: "C1", ts: "2.0" });
    };
    const landed = await post(fetcher, "t", {
      channel: "C1",
      text: "hi",
      threadTs: "1.0",
    });
    expect(landed).toEqual({ channel: "C1", ts: "2.0" });
    expect(sent.thread_ts).toBe("1.0");
    expect(sent.unfurl_links).toBe(false);
  });

  test("a refusal or a failure is reported, never thrown", async () => {
    const reasons: string[] = [];
    const fail = (reason: string) => reasons.push(reason);
    const message = { channel: "C1", text: "hi" };
    expect(
      await post(
        answer({ ok: false, error: "not_in_channel" }),
        "t",
        message,
        fail,
      ),
    ).toBeUndefined();
    expect(
      await post(
        async () => {
          throw new Error("offline");
        },
        "t",
        message,
        fail,
      ),
    ).toBeUndefined();
    expect(reasons).toEqual(["not_in_channel", "Error: offline"]);
  });
});
