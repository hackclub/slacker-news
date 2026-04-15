# Slacker News

A community-driven news aggregator built with [Astro](https://astro.build), highlighting stories that matter to builders and creative people. Run by [Hack Club](https://hackclub.com).

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

### Styling

Styles are compiled from SCSS to CSS before each build:

```bash
bun run styles
```

This is automatically run by `dev` and `build` commands.

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
├── components/          # Reusable Astro components
├── layouts/            # Page layouts (BaseLayout, PageLayout)
├── lib/                # Utilities (content loading, site config)
├── pages/              # Routes and pages
│   ├── [slug].astro   # Dynamic post routes
│   ├── index.astro    # Homepage
│   ├── feed.xml.js    # RSS feed endpoint
│   └── ...            # Section pages
├── site/              # Content data
│   ├── site.yml       # Site configuration
│   ├── data/          # YAML data files (frontpage, changelog, etc.)
│   └── posts/         # Markdown posts
└── styles/            # SCSS stylesheets

public/               # Static assets
```

## Adding Content

### Posts

Create new posts in `src/site/posts/` with the naming format: `YYYY-MM-DD-slug.md`

```markdown
---
title: Post Title
excerpt: Brief description shown in listings
date: 2026-04-15
---

Post content in Markdown format goes here.
```

### Site Data

Site configuration and frontpage data live in `src/site/`:
- **site.yml** — Site title, description, and metadata
- **data/frontpage.yml** — Pinned posts and sections on homepage
- **data/changelog.yml** — Changelog entries
- **data/acknowledgements_frontpage.yml** — Featured contributors

## Testing

Run the test suite:

```bash
bun run test
```

Tests verify the RSS feed generation and critical build paths.

## Deployment

The project includes a `Dockerfile` for containerized deployment. Build and run with:

```bash
docker build -t slacker-news .
docker run -p 3000:3000 slacker-news
```

The container uses Bun for all build and runtime operations and serves the static production build.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) or open an issue to discuss changes.

## License

[MIT](LICENSE) – See the repository for details.
