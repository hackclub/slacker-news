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

With the CMS (see "EmDash CMS" below), the first three move into it and the
files only seed a new database.

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
node scripts/emdash-import-once.mjs data/emdash.db seed/short-changelogs.json short-changelogs
node scripts/emdash-after-seed.mjs data/emdash.db  # bylines for the people credited
bunx emdash secrets generate --write .env          # EMDASH_ENCRYPTION_KEY
bun run dev:emdash
```

`emdash:seed` writes three files: `seed.json` (the content model, the site's
title and description, and every MDX file), `model.json` (the content model
alone, applied on every start of the container so new fields reach a live
site) and `short-changelogs.json` (the one-line changelog entries).

EmDash is pinned to one version in `package.json`. The newsroom's comments and
suggestions use the rich-text editor's internal `editor` object, which is not
a public EmDash API, so after upgrading EmDash, try commenting and suggesting
before deploying.

The first visit to `/_emdash/admin` creates the administrator account.

The admin is branded **Slacker Newsroom** (`admin` in `astro.config.mjs`); the
public site keeps the name Slacker News.

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

##### Slack

With a Slack app's bot token the newsroom reports to Slack. An administrator
sets it up in the admin, under Plugins, Newsroom, Settings: the bot token
(scope `chat:write`, kept encrypted), the channel's ID, and three switches for
what is sent (new drafts to the channel, review steps to the channel, direct
messages). The token and channel can instead come from `SLACK_BOT_TOKEN` and
`NEWSROOM_SLACK_CHANNEL`; a setting wins over the environment. Invite the bot
to the channel, or give it `chat:write.public`. Without a token nothing is
sent, and a message Slack refuses is logged and never blocks the work that
caused it.

The **Slack** page in the admin's menu (administrators only) shows which bot
and channel are in use, and has buttons that send a test message to the
channel and to you.

- **The channel** gets one message for each new draft, with a link to it and
  its author. The rest of that article's review goes under it as replies: sent
  for review, changes requested, each approval, an edit that voids an approval,
  and published.
- **A person** gets a direct message from the bot when something needs them:
  the author when an editor comments, suggests edits, asks for changes,
  approves or publishes; everyone in a comment thread when someone replies; a
  suggestion's writer when it is accepted or rejected; a named approver when an
  article is sent for review; someone added as a collaborator. Nobody is told
  about what they did themselves. Suggestions are announced at most once every
  30 minutes per person and article, since typing in suggesting mode saves
  often.

The bot knows who to message from Hack Club Auth, which gives each person's
Slack ID at sign-in. Someone who last signed in before this was added gets no
direct messages until they sign in again.

##### Still to do

- **Notifications, the rest.** Slack covers the review cycle (see "Slack"
  above). Still missing: email for the same events (only a review request and
  its decision are emailed; email is meant to go through Loops), a message
  when someone is mentioned in a comment, a choice per person of what they
  hear about, and a digest in place of single messages.

#### Rich-text body

Posts, changelogs and pages each have two bodies, rich text and MDX, and a
**Body format** that picks one. Only the chosen body is shown in the editor;
the other is kept. New articles are rich text. Articles moved from the MDX
files are MDX, and stay so unless an editor switches them. Submitters only get
rich text: the switch is hidden from them, and their saves are kept to the
rich-text body.

Type `/` in the rich-text body to add a YouTube video, caption, formula on its
own line or raw HTML; these are the same components MDX posts use
(`src/cms/rich/blocks.mjs`). In a sentence, `:name:` is a Slack emoji and
`$$x^2$$` a formula, as in Slack and in the MDX files.

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

Known gaps: images need their media URL to be resolved; comments and
suggestions work only on the rich-text body, not on the MDX one. They rely on
the editor handing its `editor` object to the page (`.ProseMirror` elements
carry it), which is not a public EmDash API.

#### People, and the editor's sidebar

The people the site credits are bylines in the CMS, each with two fields: a
**Slack ID** and **Roles** (`editor`, `technical`, `content`, comma-separated).
`scripts/emdash-after-seed.mjs` makes one byline for each person in
`src/data/acknowledgements.json`, once per database; after that the
acknowledgements page lists the bylines, and people are added, changed and
removed in **Bylines**. On every start it also credits bylines to any article
that only has the old `author` text.
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

#### Submitters

Everyone below the Editor role is a submitter: an outside contributor, trusted
no more than a member of the public. EmDash's own roles are looser than that
(a contributor can list every post and read every draft), so the site puts its
own rules in front of EmDash's API (`src/cms/newsroom/submitters.ts`) and
refuses a submitter anything not on a short list. A submitter can:

- list, open, edit and delete the posts they wrote, and nothing else: no other
  drafts, no published posts, no changelogs, pages, media library, users,
  search or dashboard;
- comment and suggest on their own posts, and send them for review;
- open a post they were added to as a **collaborator**, read it, comment and
  suggest. Collaborators are added by email in the **Collaborators** section
  of the editor's sidebar, by the post's author or an editor, and find the
  post under **Shared with me**. EmDash lets only the author and editors
  change a post's text, so a collaborator cannot edit it directly.

Only editors publish, schedule or approve. A submitter's save is cut down to
what a submitter may set (`content:beforeSave` in the plugin): the rich-text
body only, never the MDX body, which is code, and no raw HTML block. The
admin hides the pages and buttons a submitter cannot use
(`submitter-ui.ts`); that is for tidiness, the server is what refuses.

The rich text of an article is turned into MDX and compiled when the page is
drawn, so `to-mdx.ts` is a security boundary: it escapes everything a
submitter can type, and has tests for the ways text could become code. A
renderer that draws rich text without compiling it would be safer still, and
is worth doing before opening the newsroom to the public.

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
Club. EmDash still draws its passkey and email-link controls next to the Hack
Club button on the login, setup and invite screens; the button hides them
(`src/cms/hackclub-auth/admin.tsx`).

Add this redirect URI to the Hack Club Auth app, replacing the origin with the
site's own:

```
https://news.example.com/_emdash/api/auth/hackclub/callback
```

The CMS uses `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET`, the same app as
reader sign-in. To give it an app of its own, set
`EMDASH_OAUTH_HACKCLUB_CLIENT_ID` and `EMDASH_OAUTH_HACKCLUB_CLIENT_SECRET`.

Any Hack Club member with a verified email can sign in to the CMS. A person
who signs in for the first time becomes a Contributor: an external contributor
who works only on their own articles. An editor or administrator can raise
their role afterwards. Exceptions:

- a Hack Club account already linked to a CMS user signs in as that user;
- a verified email that matches a CMS user, or the invite link followed, signs
  in as that user, with that user's or invite's role;
- people listed in `EMDASH_HACKCLUB_ADMINS` become administrators. It takes
  Slack IDs or email addresses, separated by commas.

Until the site has an administrator, the first person to sign in becomes one.
Set `EMDASH_HACKCLUB_ADMINS` before deploying to a public address, so that
only the people it lists can.

`scripts/build-emdash-seed.ts` is the migration. It turns every MDX file into a
published entry in one of three collections (Posts, Changelogs, Pages) and
keeps the same URLs. Applying the seed again skips entries that already exist.

A migrated article's body is stored as MDX in a text field and compiled when
the page is requested, so it renders the same as before, components included.
It stays MDX, edited as source, unless an editor switches it to rich text (see
"Rich-text body"). MDX is code: anyone who can edit an MDX body can run
JavaScript on the server, which is why only editors get it.

What used to be in `src/data` is edited in the CMS:

- **Site title and description**: Settings, General.
- **Front page headline**: the **Front page** page of the newsroom plugin. Pick
  a news post or changelog, or type the address of an article published from
  Slack. Empty leads with the newest article.
- **One-line changelog entries**: changelogs with no body. The title is the
  change. They are listed on the changelog page and get no page of their own.
  `src/data/changelog.json` is imported once into a new or existing database
  (`scripts/emdash-import-once.mjs`); after that, editors add and remove them.
- **Acknowledgements**: bylines, as described under "People".

The files stay for the site without the CMS.

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
