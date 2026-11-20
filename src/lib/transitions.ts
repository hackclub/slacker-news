// A page's title and opening paragraph, and the link-card title and excerpt
// pointing at that page, share keys taken from the URL path, which both ends
// know. Cards carry them as data-vt-title and data-vt-excerpt; an article
// marks its body with data-vt-body and its first paragraph takes the excerpt
// key. BaseLayout turns keys into view-transition-names only for the page
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
