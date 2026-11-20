import { getSlackUserAvatarUrl } from "./slack-users";

// A Slack profile picture through our own cached route
// (src/pages/api/avatars/[id].ts).
export function avatarUrl(slackId: string): string {
  return `/api/avatars/${encodeURIComponent(slackId)}`;
}

// Where an avatar should load from: Slack's CDN directly when the page's own
// Cachet lookup (the one that also finds the user's name) names the picture,
// so it costs no request to us; otherwise the cached route.
export async function avatarSrc(slackId: string): Promise<string> {
  return (await getSlackUserAvatarUrl(slackId)) ?? avatarUrl(slackId);
}
