// Cachet redirects this straight to the user's Slack avatar, so the picture
// costs no API call of our own.
export function avatarUrl(slackId: string): string {
  return `https://cachet.hackclub.com/users/${encodeURIComponent(slackId)}/r`;
}
