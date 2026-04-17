# Slacker News

Official news from Hack Club Slack; built with [Astro](https://astro.build); highlighting stories that matter to hackers and makers. Run by [Hack Club](https://hackclub.com).

## Prerequisites

- **Bun** 1.2.9 or later ([install](https://bun.sh))
- **Node.js** 18+ (optional, for compatibility)

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/hackclub/slacker-news.git
cd slacker-news
bun install
```

## Development

Start the development server with hot reload:

```bash
bun run dev
```

The site will be available at `http://localhost:3000` by default. Changes to content files, components, and styles rebuild automatically.

Styles are authored in `src/styles/main.scss` and bundled by Astro.

Posts live in `src/content/posts/` as MDX files. Slack user mentions use the shared `SlackMention` component inside post bodies.

## Building for Production

Create an optimized production build:

```bash
bun run build
```

Output is generated in the `dist/` directory.

Preview the production build locally:

```bash
bun run preview
```

## Project Structure

```
src/
├── components/         # Shared Astro components
├── content/            # Astro content collections
│   ├── pages/          # About and submissions pages
│   └── posts/          # MDX articles
├── data/               # Site/frontpage/changelog/acknowledgements JSON data
├── layouts/            # Page layouts (BaseLayout, PageLayout)
├── lib/                # Utilities (content loading, site config)
├── pages/              # Routes and pages
│   ├── [slug].astro    # Dynamic post routes
│   ├── index.astro     # Homepage
│   ├── feed.xml.js     # RSS feed endpoint
│   └── ...             # Section pages
└── styles/             # SCSS stylesheets

public/                 # Static assets
```

## Adding Content

### Posts

Create new posts in `src/content/posts/` with the naming format: `slug.mdx`

```markdown
---
title: Post Title
date: 2026-04-15
excerpt: Brief description shown in listings
---

Post content in Markdown format goes here.
```

To mention a Slack user in a post, import and use the shared component:

```mdx
import SlackMention from "../../components/SlackMention.astro";

<SlackMention name="eps" id="U09Q8MLTE58" />
```

### Site Data

Site configuration and frontpage data live in `src/data/` JSON files:
- **src/data/site.json** — Site title and description
- **src/data/frontpage.json** — Pinned posts and sections on homepage
- **src/data/changelog.json** — Changelog entries
- **src/data/acknowledgements_frontpage.json** — Featured contributors

Slack channel references are explicit. Use `SlackChannel` in MDX when you want a linked channel mention:

```mdx
import SlackChannel from "../../components/SlackChannel.astro";

<SlackChannel id="confessions" />
```

Run Astro checks:

```bash
bun run check
```

## Deployment

The project includes a `Dockerfile` for containerized deployment. Build and run with:

```bash
docker build -t slacker-news .
docker run --rm --name slacker-news -p 8080:80 slacker-news
```

The container uses Bun for all build and runtime operations and serves the static production build.

The container listens on port 80, so map it to whatever host port you want, for example `8080:80`.

Open the site over HTTP (not HTTPS):

```text
http://localhost:8080
```

If you send HTTPS to this container port (for example `https://localhost:8080`), nginx will log binary TLS bytes and return `400` because this image serves plain HTTP only.

Quick sanity check:

```bash
curl -I http://localhost:8080
```

If Docker says the port is already allocated, stop the existing container and rerun:

```bash
docker ps
docker stop <container_id_or_name>
docker run --rm --name slacker-news -p 8080:80 slacker-news
```

## Contributing

Open an issue or pull request to discuss changes.

## License

MIT
