/**
 * How a Slack person or channel is written into an article's rich text: as an
 * ordinary link to them on Slack. The editor makes these links
 * (src/cms/newsroom/mentions.ts) and the site reads them back to draw its
 * mention components (to-mdx.ts).
 */
const TEAM = "https://hackclub.slack.com/team/";
const ARCHIVES = "https://hackclub.slack.com/archives/";

export const userUrl = (id: string) => `${TEAM}${id}`;
export const channelUrl = (id: string) => `${ARCHIVES}${id}`;

/** The person or channel a link points at, if it is one of these. */
export function slackTarget(
  href: string,
): { kind: "user" | "channel"; id: string } | undefined {
  const user =
    /^https:\/\/(?:[\w-]+\.)*slack\.com\/team\/([UW][A-Z0-9]{6,})\/?$/.exec(
      href,
    );
  if (user) return { kind: "user", id: user[1] };
  const channel =
    /^https:\/\/(?:[\w-]+\.)*slack\.com\/archives\/([CG][A-Z0-9]{6,})\/?$/.exec(
      href,
    );
  if (channel) return { kind: "channel", id: channel[1] };
  return undefined;
}
