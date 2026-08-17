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
- Slack-backed columns with optional Hack Club OIDC protection
- Privacy-concious analytics (abacus)

## Technical Contributions

### Prerequisites

- **Bun** 1.2.9 or later ([install](https://bun.sh))
- **Node.js** 18+ (optional, for compatibility)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/hackclub/slacker-news.git
cd slacker-news
bun install
```

### Development

Start the development server with hot reload:

```bash
bun run dev
```

The site will be available at `http://localhost:3000` by default. Changes to content files, components, and styles rebuild automatically.

Styles are authored in `src/styles/main.scss` and bundled by Astro.

Posts live in `src/content/posts/` as MDX files. Slack user mentions use the shared `SlackMention` component inside post bodies.

### Slack columns

Slack-backed columns are configured in [`src/data/slack-columns.json`](src/data/slack-columns.json). Each entry maps a Slack channel to a site column:

- `column` is the site column identifier. If it matches a regular article column such as `opinion`, Slack messages are integrated into that column’s feeds; otherwise, the column gets its own homepage section.
- `channelId` identifies the Slack channel queried from Indigest.
- `title` and `subtitle` control the displayed column heading and source label.
- `homepage` controls whether the column appears on the homepage.
- `homepageLimit` and `homepageMessagesPerRow` control how many messages are shown and how they are arranged there. `limit` controls the channel page feed.
- `authRequired` protects the column behind Hack Club OIDC authentication.
- `showMetadata` controls whether structured Slack message metadata is displayed.

For example:

```json
{
  "column": "ship-of-the-week",
  "channelId": "C0BQ2CTMR25",
  "title": "Ship of the Week",
  "homepage": true,
  "homepageLimit": 3,
  "homepageMessagesPerRow": 3,
  "authRequired": true,
  "limit": 12
}
```

Slack message data is provided by [Indigest](https://github.com/matmanna/indigest). Mentions and channel names are resolved through [Flaron](https://github.com/sadeshmukh/flaron), while cached Slack user profiles and custom emojis come from [Cachet](https://github.com/taciturnaxolotl/cachet).

### Building for Production

Create an optimized production build:

```bash
bun run build
```

Output is generated in the `dist/` directory.

````

## Content Contributions

### Posts

Create new posts in `src/content/posts/` with the naming format: `slug.mdx`

```markdown
---
title: Post Title
date: 2026-04-15
excerpt: Brief description shown in listings
---

Post content in Markdown format goes here.
````

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

### Site Data

Site configuration and frontpage data live in `src/data/` JSON files:

- **src/data/site.json** - Site title and description
- **src/data/changelog.json** - Changelog entries
- **src/data/acknowledgements.json** - Featured contributors
- **src/data/slack-columns.json** - Slack-backed column configuration

Run Astro checks:

```bash
bun run check
```

## Deployment

The site is deployed on [Vercel](https://vercel.com/) using Astro SSR. Vercel uses the repository’s `vercel.json` configuration, installs with Bun, and builds with `bun run build`.

For protected Slack columns, configure these environment variables in the Vercel project:

- `BETTER_AUTH_URL` — the deployed site URL
- `BETTER_AUTH_SECRET` — a strong production secret
- `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET` — the Hack Club OAuth client credentials

## Contributing

Open an issue or pull request to discuss changes. Be aware that I (Evan) have strong opinions about how this site should look. I favor minimal, bold design and lightweight code. If a PR changes the look of the site, feel free to DM on Slack to ask first.
