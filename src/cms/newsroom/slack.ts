/**
 * Slack messages from the newsroom, free of EmDash types so they can be tested
 * on their own. plugin.ts decides when to send; this file decides what is sent
 * and talks to Slack.
 *
 * Two kinds of message:
 *  - to the newsroom channel: one message per article, posted when a submitter
 *    starts a draft, with the rest of the article's review as replies under it;
 *  - to a person, as a direct message from the bot, when something needs them.
 *
 * It needs a Slack app's bot token (SLACK_BOT_TOKEN) with the `chat:write`
 * scope, and the bot in the channel (or `chat:write.public`). Without a token
 * nothing is sent.
 */

const POST_MESSAGE = "https://slack.com/api/chat.postMessage";

/** Slack reads `&`, `<` and `>` as markup. */
export function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function link(url: string, label: string): string {
  // A `|` or `>` in the address would end the link early.
  return `<${url.replaceAll("|", "%7C").replaceAll(">", "%3E")}|${escape(label)}>`;
}

const SLACK_ID = /^[UW][A-Z0-9]{6,}$/;

/** A real mention when the person's Slack ID is known, else their name. */
export function mention(name: string, slackId?: string | null): string {
  return slackId && SLACK_ID.test(slackId) ? `<@${slackId}>` : escape(name);
}

/** A passage or note, cut short and quoted. */
export function quote(text: string, max = 280): string {
  const flat = text.trim().replaceAll(/\s+/g, " ");
  if (!flat) return "";
  const cut = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return `\n>${escape(cut)}`;
}

export type Article = { title: string; url: string };
export type Person = { name: string; slackId?: string | null };

const article = (a: Article) => link(a.url, a.title || "Untitled");
const by = (p: Person) => mention(p.name, p.slackId);

/** What each event says. `channel` texts go under the article's message. */
export const say = {
  draft: (a: Article, author: Person) =>
    `New draft: ${article(a)} by ${by(author)}`,
  submitted: (a: Article, author: Person) =>
    `${by(author)} sent ${article(a)} for review.`,
  changesRequested: (a: Article, editor: Person, note: string) =>
    `${by(editor)} asked for changes on ${article(a)}.${quote(note)}`,
  approvalRecorded: (a: Article, editor: Person, have: number, need: number) =>
    `${by(editor)} approved ${article(a)} (${have} of ${need}).`,
  approved: (a: Article, editor: Person) =>
    `${by(editor)} approved ${article(a)}. An editor can publish it.`,
  voided: (a: Article, editor: Person) =>
    `${by(editor)} edited ${article(a)} after it was approved. It is back in review.`,
  published: (a: Article) => `${article(a)} is published.`,
  comment: (a: Article, from: Person, body: string, passage: string) =>
    `${by(from)} commented on ${article(a)}.${quote(passage, 120)}${quote(body)}`,
  reply: (a: Article, from: Person, body: string) =>
    `${by(from)} replied in a thread on ${article(a)}.${quote(body)}`,
  suggested: (a: Article, from: Person) =>
    `${by(from)} suggested edits to ${article(a)}.`,
  decided: (a: Article, from: Person, accepted: boolean, passage: string) =>
    `${by(from)} ${accepted ? "accepted" : "rejected"} your suggestion on ${article(a)}.${quote(passage, 120)}`,
  added: (a: Article, from: Person) =>
    `${by(from)} added you to ${article(a)}. You can read it, comment and suggest edits.`,
};

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type Sent = { channel: string; ts: string };

/**
 * Posts one message. `channel` is a channel ID, or a person's Slack ID for a
 * direct message. Returns where it landed, or undefined when Slack refused;
 * `fail` hears why.
 */
export async function post(
  fetcher: Fetch,
  token: string,
  message: { channel: string; text: string; threadTs?: string },
  fail: (reason: string) => void = () => {},
): Promise<Sent | undefined> {
  try {
    const response = await fetcher(POST_MESSAGE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: message.channel,
        text: message.text,
        ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
        // An article's address is not worth a preview card.
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const answer = (await response.json()) as {
      ok?: boolean;
      error?: string;
      channel?: string;
      ts?: string;
    };
    if (!answer.ok || !answer.channel || !answer.ts) {
      fail(answer.error ?? `HTTP ${response.status}`);
      return undefined;
    }
    return { channel: answer.channel, ts: answer.ts };
  } catch (error) {
    fail(String(error));
    return undefined;
  }
}
