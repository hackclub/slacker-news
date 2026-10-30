# Comments plan

Comments on articles, viewable only while logged in, limited to two per day (Eastern time) and three total per account. A comment is a Slack thread reply under the article's card in #news. Posting happens in Slack; the site only reads.

Status: planning. The site side is behind `COMMENTS_CHANNEL_ID` and does nothing until it is set.

## How it fits together

- **slacker-news-rss** posts a card for each new article to #news. The card carries the canonical article URL in its text (today it is only in the blocks) and a line telling readers that thread replies appear on the site.
- **Indigest** ingests thread replies in the comments channel. It stores the card as the parent, extracts the article key (`/news/slug/`, path only) at ingest, and exposes `GET /api/threads?channel=&key=`.
- **Limits** are a pure function of a user's history: replies on article cards ordered by Slack ts, valid if within the first 3 ever and 2 per Eastern day. Deleted comments still count. The site hides anything over a limit whether or not Slack deletion succeeds.
- **Enforcement** deletes over-limit replies through the Prometheus API, using a key owned by a #news channel manager. Visibility never depends on that call succeeding.
- **Site** adds an SSR route `/<column>/<slug>/comments/` (no JS, `Cache-Control: private, no-store`, redirect to login when signed out). Prerendered article pages link to it.

## Deletes and edits

- `message_deleted` events tombstone a row: the text is purged, the ts and user stay so the limit count is stable.
- `message_changed` updates the text and sets `editedAt`; the site shows "edited".
- A `reconcileThread` primitive (also behind `/in rescan`, an API call, and a tiered cron) pages `conversations.replies` to add missed replies, apply edits and tombstone anything Slack no longer returns. It only tombstones after a complete fetch.

## Reply modes and the queue channel

`replyMode` per channel and per user: `off`, `auto`, `review` (publish, and post a Remove card to the queue channel), `manual` (hold until approved in the queue channel). In manual mode an edit sends a published comment back to pending. Limits are checked first, so over-limit replies never enter the queue.

## Testing

Point `COMMENTS_CHANNEL_ID` at a test channel. Vercel previews of the `comments-from-news-channel` branch use `C0CDSH7G760`.
