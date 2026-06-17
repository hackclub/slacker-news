/**
 * Generate an Abacus counter key based on the page pathname
 * Examples:
 *   "/" → "page_index"
 *   "/about" → "page_about"
 *   "/news/article-name" → "news_article-name"
 *   "/opinion/better-goodbyes" → "opinion_better-goodbyes"
 */
export function generateAbacusKey(pathname: string): string {
  // Remove leading/trailing slashes
  const cleanPath = pathname.replace(/^\/+|\/+$/g, "");

  if (!cleanPath) {
    return "page_index";
  }

  const normalizedSegments = cleanPath
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .map((segment) => segment.toLowerCase().replace(/[^a-z0-9_.-]/g, "-").replace(/-+/g, "-"))
    .map((segment) => segment.replace(/^-+|-+$/g, ""))
    .filter(Boolean);

  if (normalizedSegments.length === 0) {
    return "page_index";
  }

  if (normalizedSegments.length === 1) {
    // Single-level page like "/about" → "page_about"
    return `page_${normalizedSegments[0]}`.slice(0, 64);
  }

  // Multi-level like "/news/article-name" → "news_article-name"
  return normalizedSegments.join("_").slice(0, 64);
}

/**
 * Get the Abacus API URL for hitting a counter
 */
export function getAbacusHitUrl(key: string, namespace: string = "news.hackclub.com"): string {
  return `https://abacus.jasoncameron.dev/hit/${namespace}/${key}`;
}

/**
 * Get the Abacus API URL for retrieving counter value
 */
export function getAbacusGetUrl(key: string, namespace: string = "news.hackclub.com"): string {
  return `https://abacus.jasoncameron.dev/get/${namespace}/${key}`;
}
