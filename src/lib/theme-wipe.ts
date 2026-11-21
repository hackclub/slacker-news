// Switching between light and dark mode as one halftone sweep: the page in
// its new colours spreads out from the toggle, and its edge breaks up into a
// screen of dots, the way a halftone fades out. The old page stays on screen
// ahead of the edge, so nothing goes blank.
//
// It's a view transition of the whole page (main.scss, "Theme wipe"): the
// new page is masked to a growing circle with a dotted rim. Browsers without
// view transitions, and readers who prefer reduced motion, get a plain switch.

const DURATION = 650;

let busy = false;

export function themeWipe(from: Element | null, swap: () => void) {
  const start = (document as Document & {
    startViewTransition?: (update: () => void) => { finished: Promise<void> };
  }).startViewTransition;
  if (busy) return;
  if (!start || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    swap();
    return;
  }

  const root = document.documentElement;
  const box = from?.getBoundingClientRect();
  const x = box ? box.left + box.width / 2 : innerWidth / 2;
  const y = box ? box.top + box.height / 2 : 0;
  // Far enough to pass the farthest corner, rim included.
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 160;

  root.style.setProperty("--wipe-x", `${x}px`);
  root.style.setProperty("--wipe-y", `${y}px`);
  root.style.setProperty("--wipe-end", `${end}px`);
  root.style.setProperty("--wipe-duration", `${DURATION}ms`);
  root.classList.add("theme-wiping");
  busy = true;

  const done = () => {
    root.classList.remove("theme-wiping");
    for (const name of ["--wipe-x", "--wipe-y", "--wipe-end", "--wipe-duration"]) {
      root.style.removeProperty(name);
    }
    busy = false;
  };

  try {
    start.call(document, swap).finished.finally(done);
  } catch {
    done();
    swap();
  }
}
