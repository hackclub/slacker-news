// Fetch a story before it's clicked, so the transition into it starts sooner
// on a slow connection. The router can't animate until the next page has
// arrived; a page already fetched arrives at once.
//
// With a mouse, a story is fetched once the pointer rests on its link (or
// keyboard focus lands on it). On a touch screen there is no hover, so it is
// fetched the moment a finger touches the link, ahead of the click that
// follows the finger lifting.
//
// A story link is any link whose page has a card title on this one
// (data-vt-title, see transitions.ts), which covers every listing, the
// search results built in the browser, and the linked stories under an
// article, without marking each link.

import { prefetch } from "astro:prefetch";
import { titleTransitionName } from "./transitions";

// How long the pointer rests on a link before it counts as intent, the same
// wait Astro's own hover prefetch uses.
const HOVER_DELAY = 80;

function storyLink(target: EventTarget | null): HTMLAnchorElement | null {
  const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!anchor || anchor.origin !== location.origin) return null;
  const name = titleTransitionName(anchor.pathname);
  return document.querySelector(`[data-vt-title="${CSS.escape(name)}"]`) ? anchor : null;
}

let hoverTimer = 0;

function hoverIn(anchor: HTMLAnchorElement | null) {
  clearTimeout(hoverTimer);
  if (anchor) hoverTimer = window.setTimeout(() => prefetch(anchor.href), HOVER_DELAY);
}

export function initStoryPrefetch() {
  document.addEventListener(
    "pointerover",
    (event) => {
      if (event.pointerType === "mouse") hoverIn(storyLink(event.target));
    },
    { passive: true },
  );
  document.addEventListener(
    "pointerout",
    (event) => {
      if (event.pointerType === "mouse") clearTimeout(hoverTimer);
    },
    { passive: true },
  );
  document.addEventListener("focusin", (event) => hoverIn(storyLink(event.target)), { passive: true });
  document.addEventListener("focusout", () => clearTimeout(hoverTimer), { passive: true });

  // A deliberate touch, so it goes ahead even on Data Saver or 2G, as
  // Astro's own tap prefetch does.
  document.addEventListener(
    "touchstart",
    (event) => {
      const anchor = storyLink(event.target);
      if (anchor) prefetch(anchor.href, { ignoreSlowConnection: true });
    },
    { passive: true },
  );
}
