# Slacker News

Official news from the [Hack Club](https://hackclub.com?uwu) Slack, highlighting stories that matter to hackers and makers.

![cover image](https://cdn.hackclub.com/019dbae9-5242-745b-acd2-3476ab3c52a3/og-default.png)

## About

As of now, some of the cool things Slacker News has include:

- Distinct content columns including news, opinion, essays, and changelogs
- Response and follow-up posts
- RSS Feeds
- Headline Images
- Dynamic OpenGraph Metadata
- Light/dark mode
- Slack channel/user tagging
- Slack-backed columns with optional Hack Club Auth-gating (Better Auth)
- Privacy-concious analytics (Plausible)

## Contributing

### Technical Contributions

Open an issue or pull request to discuss changes. Be aware that I (Evan) have strong opinions about how this site should look. I favor minimal, bold design and lightweight code. If a PR changes the look of the site, feel free to DM @eps on Slack to ask first.

### Content Contributions

If your content submission has not been pre-approved, follow the Submission [guidelines](https://news.hackclub.com/submissions/) for how to proceed. But if you do have authorization to add an article through PR, follow the below instructions:

Create posts in `src/content/posts/` with the naming format: `slug.mdx`

```markdown
---
title: Post Title
date: 2026-04-15
excerpt: Brief description shown in listings; several paragraphs make the front page preview when this is the headline
---
```

To mention a Slack user in a post, import and use the SlackMention component:

```mdx
import SlackMention from "../../components/SlackMention.astro";

<SlackMention name="eps" id="U09Q8MLTE58" />
```

and to mention a Slack channel, use the SlackChannel component

```mdx
import SlackChannel from "../../components/SlackChannel.astro";

<SlackChannel id="confessions" />
```

## Development

### Itallation

Clone the repository and install dependencies:

```bash
git clone https://github.com/hackclub/slacker-news.git
cd slacker-news
bun install
```

### Prerequisites

- **Bun** 1.2.9 or later ([install](https://bun.sh))
- **Node.js** 18+ (optional, for compatibility)

Start the development server with hot reload:

```bash
bun run dev
```

The site will be available at `http://localhost:3000` by default. Changes to content files, components, and styles rebuild automatically.

Styles are authored in `src/styles/main.scss` and bundled by Astro.

Posts live in `src/content/posts/` as MDX files. Slack user mentions use the shared `SlackMention` component inside post bodies.

### Site Data

Site configuration and frontpage data live in `src/data/` JSON files:

- **src/data/site.json** - Site title and description
- **src/data/changelog.json** - Changelog entries
- **src/data/acknowledgements.json** - Featured contributors
- **src/data/slack-columns.json** - Slack-backed column configuration

Slack message data is provided by [Indigest](https://github.com/matmanna/indigest). Mentions and channel names are resolved through [Flaron](https://github.com/sadeshmukh/flaron), while cached Slack user profiles and custom emojis come from [Cachet](https://github.com/taciturnaxolotl/cachet).

A Slack column in `src/data/slack-columns.json` with `"markdownColumns": true` publishes articles into the markdown columns (news, opinion, essays) instead of a row of its own, so one channel can feed all three. Each message's Indigest metadata must give its `title` and `column`, and may give a `slug`, an `author` (a Slack user ID, shown as a mention, or a name) and a `publishdate` (a day such as `2026-10-06`, epoch seconds, or any date string). Without an author or publish date, the article shows who posted the message and when. An article lives at `/<column>/<slug>/`, where the slug defaults to the slugified title, next to the markdown posts. In `/feed.xml`, protected ones join their categories only with `include=protected` and a token that can read them.

`src/data/protected-article-metadata.json` is the Indigest metadata form for such a channel. Set it there with `/in schema set <contents of the file>`.

### Building for Production

Run Astro checks:

```bash
bun run check
```

Create an optimized production build:

```bash
bun run build
```

Output is generated in the `dist/` directory.

## Deployment

The site is deployed on [Vercel](https://vercel.com/) using Astro SSR. Vercel uses the repository’s `vercel.json` configuration, installs with Bun, and builds with `bun run build`.

For protected Slack columns, configure these environment variables in the Vercel project:

- `BETTER_AUTH_URL` - the deployed site URL
- `BETTER_AUTH_SECRET` - a strong production secret
- `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET` - the Hack Club OAuth client credentials
- `INDIGEST_API_KEY` - an Indigest API key scoped to every Slack column's channel. For private RSS links it must also be a delegating key (see below)
- `RSS_ACCESS_TOKEN` - optional legacy shared token that unlocks every protected column in `/feed.xml`

### EmDash CMS

The site can read its articles from [EmDash](https://emdashcms.com) instead of
the MDX files, so they can be written and edited in a browser at
`/_emdash/admin`. This is opt-in: set `CMS=emdash` when building. Without it
the site reads `src/content` as before, which is what the Vercel deployment
does.

EmDash mode is fully self-hosted. As configured here it needs a long-running
Node server and a writable disk, and runs nothing on Cloudflare: content is a SQLite file,
uploads are local files, and sandboxed plugins run in a local
[workerd](https://github.com/cloudflare/workerd) process.

```bash
bun run emdash:seed                                # src/content -> seed/seed.json
bunx emdash seed seed/seed.json -d data/emdash.db  # create and fill the database
bunx emdash secrets generate --write .env          # EMDASH_ENCRYPTION_KEY
bun run dev:emdash
```

The first visit to `/_emdash/admin` creates the administrator account.

#### Newsroom workflow (prototype)

The `newsroom` plugin (`src/cms/newsroom`) adds an editorial process to the
Posts collection. It is a prototype: it works through the admin and API, but has
only been tried with a handful of test articles. Its comments and suggestions
run as code inside the rich-text editor's page (`rich-review.tsx`), so the
plugin has to run in the server process rather than a sandbox.

- **Review.** An author sends a post for review with the **Submit for review**
  button. An editor then approves it, or requests changes with a note.
- **Gate.** A post cannot be published or scheduled until the approvals are in
  for the text as it is. This is checked on the server for the admin, the API
  and the scheduler alike. Editing a post sends it back to review.
- **Permissions.** Who may do what follows EmDash's roles: authors and above
  submit, editors and above decide, and nobody decides on their own article
  (except an admin, who may be the only person there).
- **Approvers.** In the plugin's settings, require one to five different
  approvers, and optionally name who they are by email or user ID. Without a
  list, any editor can approve. Settings apply at once.
- **Comments in the text.** In the **Body (rich text)** editor, select text and
  a **Comment** button appears just above the selection. A commented passage is
  highlighted yellow with a small icon at its end; click either to open the
  thread, reply, or resolve. The **Review** panel in the sidebar is an overview
  of the same threads, with one box for a general comment; an editor can send
  that comment back to the author as a request for changes. A thread finds its
  passage again by its quoted text, so edits above it, or by someone editing at
  the same time, do not lose it; if the passage itself is edited away, the
  thread stays in the panel only.
- **Suggesting mode.** The **Suggest** switch at the end of the editor's
  toolbar turns it on. While it is on, typing, deleting and pasting do not
  change the article: text you remove stays, struck through in red, and text
  you add shows in green. Each edit is stored as a suggestion a moment after
  you stop. An editor, or the article's author, accepts one: the text then
  changes like any edit, and saving sends the article back to review.
  Rejecting leaves the text alone, and you can discard your own. Formatting,
  new paragraphs and blocks cannot be suggested; switch back to editing for
  those.
- **Queue, card and calendar.** A **Review queue** page, an "Awaiting review"
  card on the dashboard, and an editorial **Calendar** of what goes live.
- **Email.** If the site has an email provider, approvers are told when a post
  is sent for review, and its author when it is decided.
- **Other collections.** Set "Collections that need review" to include
  `changelogs` or `pages`.

##### Still to do

- **Slack and email notifications, in full.** Today the plugin sends only two
  emails: to approvers when a post is sent for review, and to its author when
  it is decided. Planned: Slack messages (a direct message or a channel post)
  and email for every event that needs someone's attention, each with a link
  to the article. That covers a review request, an approval, a request for
  changes, a new comment or reply, a mention, a suggestion made, accepted or
  rejected, a post published, and an approval voided by an edit. Each person
  chooses where they hear about what, and a digest can replace single
  messages. Slack delivery would go through Indigest or a Slack app; the
  plugin would need a Slack identity for each editor, which Hack Club Auth
  already supplies.

#### Rich-text body (prototype)

Posts have a second body field, **Body (rich text)**, next to the MDX one. Set
**Body format** to `rich` and the page is drawn from the rich-text field
instead. Type `/` in it to add a YouTube video, caption, formula, Slack user or
channel, emoji or raw HTML; these are the same components MDX posts use
(`src/cms/rich/blocks.mjs`).

The editor stores Portable Text, not MDX. When the page is requested,
`src/cms/rich/to-mdx.ts` turns it into MDX and the usual pipeline draws it, so
markdown rules and components behave the same in both. Existing posts are not
converted, and nothing changes for them.

Slack people and channels go inside a sentence: type `@` and a few letters of
a name, or `#` and a channel's, and pick from the list that opens. The list
comes from [Flaron](https://github.com/sadeshmukh/flaron), asked by the
newsroom plugin from the server; only the letters typed are sent. The editor
stores the mention as a link to the person or channel on Slack, and the site
draws such a link as its `SlackMention` or `SlackChannel` component.

Known gaps: the emoji and formula components are blocks here, not inline in a
sentence; images need their media URL to be
resolved; comments and suggestions work only on the rich-text body, not on the
MDX one. They rely on the editor handing its `editor` object to the page
(`.ProseMirror` elements carry it), which is not a public EmDash API.

#### People, and the editor's sidebar

The people the site credits are bylines in the CMS, each with two fields: a
**Slack ID** and **Roles** (`editor`, `technical`, `content`, comma-separated).
`scripts/emdash-after-seed.mjs` fills them in on every start, only where something
is missing: one byline for each person in `src/data/acknowledgements.json`, and
the credited bylines of every article that only has the old `author` text.
After that, the **Bylines** section of the editor's sidebar picks them, any
number can be reused, and new ones are made in **Bylines** in the admin menu.
The site reads authors, and the acknowledgements page, from the bylines; the
old `author` text and the JSON file are the fallback for anything not yet
credited. Names and Slack IDs are edited in **Bylines**, with **Byline Schema**
holding the two fields.

Some fields move to a **Links and visibility** section of the sidebar, drawn by
`src/cms/newsroom/sidebar.tsx`: the body format, the members-only switch, and
**Response to** and **Follow-up to** as pickers of other articles by title. They
are still ordinary fields, so saving, drafts and co-editing work as before.
Choosing a body format shows only that body in the editor; the other is kept.
The author text field is hidden. EmDash gives a plugin no way to place a field
in the sidebar, so the widgets draw their controls there and hide their place
in the main column by the `data-co-editing-field` mark on each field; if
EmDash stops marking fields that way, they stay in the main column.

The category (news, opinion, essays) is a taxonomy: pick it under
**Taxonomies** in the sidebar. It is still the first part of an article's
address, so changing it moves the article, and an article with no category is
left off the site. **Summary** is the one description field: its first
paragraph is the short text for lists, search and RSS, and if it has several
paragraphs the front page shows them when the article is the headline, in
place of the opening paragraphs. Posts no longer have an expiry date. On start,
`scripts/emdash-after-seed.mjs` also turns each existing post's category into
its term, merges a front page preview into the summary, and removes the old
fields. A **Response to** or **Follow-up to** link is stored as the article's
slug, so it survives a change of category; `category/slug` written in an MDX
file still works.

#### Co-editing

Several people can edit the same article at once and see each other's cursors
(`coEditing` in `astro.config.mjs`). Edits are saved to the article about two
seconds after typing stops, through the normal save, so the newsroom plugin's
rules still apply: any edit voids approvals. It needs the Node server run as a
single process, as `Dockerfile.emdash` does. On a host that cannot run it, the
editor falls back to one editor at a time with an edit lock.

#### Signing in with Hack Club

[Hack Club Auth](https://auth.hackclub.com) is the only way to sign in to the
admin, through the provider in `src/cms/hackclub-auth`. EmDash's passkey and
email-link sign-in are switched off: the site refuses their endpoints
(`src/cms/hackclub-auth/only.ts`), and the login page goes straight to Hack
Club. EmDash still draws its passkey button on the setup and error screens; it
does nothing.

Add this redirect URI to the Hack Club Auth app, replacing the origin with the
site's own:

```
https://news.example.com/_emdash/api/auth/hackclub/callback
```

The CMS uses `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET`, the same app as
reader sign-in. To give it an app of its own, set
`EMDASH_OAUTH_HACKCLUB_CLIENT_ID` and `EMDASH_OAUTH_HACKCLUB_CLIENT_SECRET`.

Every Hack Club member can sign in to Hack Club Auth, so signing in is not
enough to get into the CMS. A person is let in when:

- their Hack Club account is already linked to a CMS user;
- their verified email matches a CMS user, or the invite link they followed;
- they are listed in `EMDASH_HACKCLUB_ADMINS`, which makes them an
  administrator. It takes Slack IDs or email addresses, separated by commas.

Until the site has an administrator, the first person to sign in becomes one.
Set `EMDASH_HACKCLUB_ADMINS` before deploying to a public address, so that
only the people it lists can.

`scripts/build-emdash-seed.ts` is the migration. It turns every MDX file into a
published entry in one of three collections (Posts, Changelogs, Pages) and
keeps the same URLs. Applying the seed again skips entries that already exist.

An article's body is stored as MDX in a text field and compiled when the page
is requested, so migrated articles render the same as before, components
included. Two consequences:

- The body is edited as MDX source, not in a rich text editor.
- MDX is code. Anyone who can edit an article can run JavaScript on the
  server, so give CMS accounts only to people who could commit to this
  repository.

The front page settings, short changelog entries and acknowledgements still
come from `src/data`.

#### Members-only articles

Each post has a **Members only** switch in the CMS. A post with it on can be
read only by someone signed in to the site with Hack Club, the same sign-in the
protected Slack columns use. Everyone else is sent to the login page, and the
post is left out of the front page, archives, ticker, search and RSS.

Signed-in readers do not get members-only posts in RSS either: the feed's
private links cover the Slack columns only.

Members-only articles can also come from a protected Slack column, read
through Indigest. To retire such a column, `scripts/import-slack-column.mjs`
copies its articles into the CMS as members-only posts, at the same URLs; then
remove the column from `src/data/slack-columns.json`. Run it where the
database is, so the articles never pass through the repository:

```bash
INDIGEST_API_KEY=... node scripts/import-slack-column.mjs <channel id> data/emdash.db
```

Those posts have their **Body format** set to `slack`: the body stays in
Slack's formatting and is drawn the way Slack messages are elsewhere on the
site.

To deploy, build `Dockerfile.emdash` and mount a volume at `/app/data`. The
container listens on port 8080 and fills a new volume from the seed when it
first starts, and brings the content model of an existing one in step with the
build. Give it about 1 GB of memory; with less, the first request can
run it out. It reads its configuration when it starts, not when it is built:

| Variable                                       | Purpose                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `EMDASH_ENCRYPTION_KEY`                        | Required. Losing it makes stored plugin secrets unreadable.                       |
| `EMDASH_SITE_URL`                              | Public origin, such as `https://news.example.com`. Passkey sign-in depends on it. |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`        | Required, as for any production build.                                            |
| `HACKCLUB_CLIENT_ID`, `HACKCLUB_CLIENT_SECRET` | Optional. Reader sign-in and the admin's Hack Club button are off without them.   |
| `EMDASH_HACKCLUB_ADMINS`                       | Optional. Slack IDs or emails that sign in as administrators.                     |
| `INDIGEST_API_KEY`                             | Optional. The Slack columns are off without it.                                   |

### Private RSS links

Slacker News has no database, so Indigest stores the per-reader feed tokens. `INDIGEST_API_KEY` is a delegating Indigest key: when a logged-in reader creates a link on `/rss/`, the site asks Indigest to mint a child key for that reader. The child can only read channels within the parent key's scope, cannot mint keys of its own, and stops working when it is revoked or when the parent key is revoked. A reader can hold any number of links; making a new one leaves the others working, and "Revoke all my links" on `/rss/` kills every one of theirs. `/feed.xml?token=` accepts only children of the site's own key. Anyone logged in can revoke a link they have by pasting it on `/rss/`. A revoked link keeps working as a public feed, plus a "Your key is revoked" item that appears again every week.

Only an Indigest admin (a `LOCKDOWN_USERS` member) can create a delegating key, by passing `canDelegate: true` and a non-empty `channelIds` list to `POST /api/api-keys`.
