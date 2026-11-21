// Switching between light and dark mode as a halftone wipe: from the toggle,
// a 45-degree screen of dots swells across the page until it's solid in the
// new theme's paper colour, the theme flips underneath, and the dots shrink
// away from the toggle to show the page in its new colours. A red plate runs
// just off register along the moving edge.
//
// Dark mode is a filter on <html> (invert, then hue-rotate), and the overlay
// sits under it. So the dots are painted in the inverted paper colour before
// the flip, which reads as the new theme's paper, and in the paper colour
// after it, which the new state shows the same way. That holds in both
// directions.

const PAPER = "#f5f5f0";
const INVERTED_PAPER = "#0a0a0f";
const CELL = 18;
const BAND = CELL * 7;
const HALF = 360;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

let busy = false;

export function themeWipe(from: Element | null, swap: () => void) {
  // A second click mid-wipe is ignored; the wipe already flips the theme.
  if (busy) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !document.body) {
    swap();
    return;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    swap();
    return;
  }

  const width = innerWidth;
  const height = innerHeight;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "2147483000",
    pointerEvents: "none",
  });
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  document.body.append(canvas);
  busy = true;

  const box = from?.getBoundingClientRect();
  const ox = box ? box.left + box.width / 2 : width / 2;
  const oy = box ? box.top + box.height / 2 : 0;

  // Dot centres on a 45-degree screen covering the viewport, with each one's
  // distance from the toggle.
  const points: { x: number; y: number; d: number }[] = [];
  const reach = Math.hypot(width, height) + CELL;
  for (let v = -reach; v < reach; v += CELL) {
    for (let u = -reach; u < reach; u += CELL) {
      const x = ox + (u - v) * Math.SQRT1_2;
      const y = oy + (u + v) * Math.SQRT1_2;
      if (x < -CELL || y < -CELL || x > width + CELL || y > height + CELL) continue;
      points.push({ x, y, d: Math.hypot(x - ox, y - oy) });
    }
  }
  const farthest = Math.max(...points.map((point) => point.d), 1);
  // Big enough that neighbouring dots on the screen overlap into solid paper.
  const full = CELL * 0.74;
  const red = getComputedStyle(document.documentElement).getPropertyValue("--hc-red").trim() || "#ec3750";

  // How far the dot at distance d has grown, for a wavefront at front.
  const grown = (front: number, d: number) => Math.min(1, Math.max(0, (front - d) / BAND));

  function paint(size: (d: number) => number, ink: string) {
    context!.clearRect(0, 0, width, height);
    // Red shows only along the moving edge: each dot there has a red rim,
    // a little off register.
    context!.fillStyle = red;
    context!.beginPath();
    for (const point of points) {
      const own = size(point.d);
      if (own <= 0.3 || own >= full - 0.5) continue;
      const r = own + CELL * 0.16;
      context!.moveTo(point.x + 2 + r, point.y + 1);
      context!.arc(point.x + 2, point.y + 1, r, 0, Math.PI * 2);
    }
    context!.fill();
    context!.fillStyle = ink;
    context!.beginPath();
    for (const point of points) {
      const r = size(point.d);
      if (r <= 0.3) continue;
      context!.moveTo(point.x + r, point.y);
      context!.arc(point.x, point.y, r, 0, Math.PI * 2);
    }
    context!.fill();
  }

  let swapped = false;
  const finish = () => {
    if (!swapped) {
      swapped = true;
      swap();
    }
    canvas.remove();
    busy = false;
  };

  const started = performance.now();
  function frame(now: number) {
    try {
      const elapsed = now - started;
      const span = farthest + BAND;
      if (elapsed < HALF) {
        const front = ease(elapsed / HALF) * span;
        paint((d) => grown(front, d) * full, INVERTED_PAPER);
      } else if (elapsed < HALF * 2) {
        if (!swapped) {
          swapped = true;
          swap();
        }
        const front = ease((elapsed - HALF) / HALF) * span;
        paint((d) => (1 - grown(front, d)) * full, PAPER);
      } else {
        finish();
        return;
      }
      requestAnimationFrame(frame);
    } catch {
      finish();
    }
  }
  requestAnimationFrame(frame);
}
