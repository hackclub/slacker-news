// Who wrote a homepage item. Markdown posts and changelogs list authors in
// frontmatter; Slack-published articles name one in metadata, or else the
// poster is the author.
export interface BylineSource {
  authors?: string | string[];
  slackIds?: string[];
  slackAuthor?: string;
  slackUserId?: string;
  slackUserName?: string;
}
