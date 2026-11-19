// A page's title and the link-card titles pointing at that page share a
// key, taken from the URL path, which both ends know. Titles carry the key
// as data-vt-title; BaseLayout turns it into a view-transition-name only on
// the clicked title and the destination title, so nothing else on the page
// animates.
export function titleTransitionName(path: string): string {
  return `title-${path.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9_-]/g, "-")}`;
}
