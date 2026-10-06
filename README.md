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
excerpt: Brief description shown in listings
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

### Private RSS links

Slacker News has no database, so Indigest stores the per-reader feed tokens. `INDIGEST_API_KEY` is a delegating Indigest key: when a logged-in reader creates a link on `/rss/`, the site asks Indigest to mint a child key for that reader. The child can only read channels within the parent key's scope, cannot mint keys of its own, and stops working when it is rotated, revoked, or when the parent key is revoked. `/feed.xml?token=` accepts only children of the site's own key. Anyone logged in can revoke a link they have by pasting it on `/rss/`. A revoked link keeps working as a public feed, plus a "Your key is revoked" item that appears again every week.

Only an Indigest admin (a `LOCKDOWN_USERS` member) can create a delegating key, by passing `canDelegate: true` and a non-empty `channelIds` list to `POST /api/api-keys`.
