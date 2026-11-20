// A page's title, body, byline and read time, and the link card's
// pointing at that page, share keys taken from the URL path, which both ends
// know. Cards carry them as data-vt-title, data-vt-excerpt, data-vt-byline
// and data-vt-reading-time; an article's body takes the excerpt key through
// data-vt-body, and its byline and read time carry the matching keys. BaseLayout turns keys into view-transition-names only for the page
// being left and the page being opened, so nothing else animates.
function pathKey(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9_-]/g, "-");
}

export function titleTransitionName(path: string): string {
  return `title-${pathKey(path)}`;
}

export function excerptTransitionName(path: string): string {
  return `excerpt-${pathKey(path)}`;
}

export function bylineTransitionName(path: string): string {
  return `byline-${pathKey(path)}`;
}

export function readingTimeTransitionName(path: string): string {
  return `reading-time-${pathKey(path)}`;
}
