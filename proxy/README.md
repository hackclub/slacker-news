# Slacker News Proxy

Auth layer in front of the Jekyll site using Hack Club Auth.

All pages require login by default. To make an article publicly accessible, add `public: true` to its frontmatter:

```yaml
---
title: My Article
public: true
---
```

The RSS feed is always accessible but shows excerpts only for unauthenticated readers.

## Environment variables

- `HCA_CLIENT_ID` — Hack Club Auth client ID
- `HCA_CLIENT_SECRET` — Hack Club Auth client secret
- `SESSION_SECRET` — Secret for signing session cookies
- `BASE_URL` — Public URL of the site (e.g. `https://news.hackclub.com`)
