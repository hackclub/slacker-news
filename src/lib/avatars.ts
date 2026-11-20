// A Slack profile picture, through our own cached route
// (src/pages/api/avatars/[id].ts) rather than straight from Cachet.
export function avatarUrl(slackId: string): string {
  return `/api/avatars/${encodeURIComponent(slackId)}`;
}
