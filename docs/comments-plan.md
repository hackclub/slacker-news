# Comments plan

Comments on articles, viewable only while logged in, limited to two per day (Eastern time) and three total per account. A comment is a Slack thread reply under the article's card in #news. Posting happens in Slack; the site only reads.

Status: planning. The site side is behind `COMMENTS_CHANNEL_ID` and does nothing until it is set.

## How it fits together

- **slacker-news-rss** posts a card for each new article to #news. The card carries the canonical article URL in its text (today it is only in the blocks) and a line telling readers that thread replies appear on the site.
- **Indigest** ingests thread replies in the comments channel. It stores the card as the parent, extracts the article key (`/news/slug/`, path only) at ingest, and exposes `GET /api/threads?channel=&key=`.
- **Limits** are a pure function of a user's history: replies on article cards ordered by Slack ts, valid if within the first 3 ever and 2 per Eastern day. Deleted comments still count. The site hides anything over a limit whether or not Slack deletion succeeds.
- **Enforcement** deletes over-limit replies through the Prometheus API, using a key owned by a #news channel manager. Visibility never depends on that call succeeding.
- **Site** shows the comments on the article page itself, under the "Have something to add to the conversation?" box. Markdown articles stay prerendered: the comments are a deferred server island (`<Comments server:defer />`, one small script fetches it), rendered per request with `Cache-Control: private, no-store`. Logged-out readers see a login link. Slack-sourced articles are already server rendered and include the same component directly.

## Deletes and edits

- `message_deleted` events set `deleted_at` on the row. The content stays in the database but no query, API or feed returns it; a tombstone query exposes only the ts and user so the limit count is stable.
- `message_changed` updates the text and sets `editedAt`; the site shows "edited".
- A `reconcileThread` primitive (also behind `/in rescan`, an API call, and a tiered cron) pages `conversations.replies` to add missed replies, apply edits and tombstone anything Slack no longer returns. It only tombstones after a complete fetch.

## Moderation

All moderation happens in Slack: channel managers delete through Prometheus or the Slack UI, and the resulting `message_deleted` event hides the comment on the site. The site has no reporting or moderation controls of its own.

## Failure modes

- Comments are read through one `getComments(key)` that returns `ok` or `unavailable`, so "no comments" is never confused with "could not check".
- When Indigest is unreachable, times out, rejects the key, or the channel is not in the key's scope, the comments section says comments are unavailable. It responds normally, never with a 500, and the article itself is unaffected.
- No stale answers: unlike the Slack columns, the comments section does not serve a cached result past its TTL while revalidating, because a stale list could show a comment that has since been deleted.
- With `COMMENTS_CHANNEL_ID` unset the section is not rendered at all.
- Indigest never marks a comment deleted from a failed or incomplete Slack lookup (`reconcileThreadDeletions`).
- Existing history is not backfilled: only replies posted after the channel is set up are stored.

## Reply modes and the queue channel

`replyMode` per channel and per user: `off`, `auto`, `review` (publish, and post a Remove card to the queue channel), `manual` (hold until approved in the queue channel). In manual mode an edit sends a published comment back to pending. Limits are checked first, so over-limit replies never enter the queue.

## Testing

Point `COMMENTS_CHANNEL_ID` at a test channel. Vercel previews of the `comments-from-news-channel` branch use `C0CDSH7G760`.
