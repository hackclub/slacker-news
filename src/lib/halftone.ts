// Text set in newsprint halftone on a canvas: the glyphs are sampled on a
// 45-degree screen and each cell becomes an ink dot sized by how much of the
// glyph covers it. The dots print in from a spray of ink, drift away from the
// pointer and spring back, and a click knocks them out in a ring. Once
// everything has settled the loop stops, so an idle plate costs nothing.
//
// The plate is an element holding a <canvas>; it gets "is-drawn" once the
// dots are up, so a plain-text fallback inside it can hide. Returns a
// function that stops the plate.

type Dot = { hx: number; hy: number; x: number; y: number; vx: number; vy: number; r: number };

export function mountHalftone(plate: HTMLElement, text: string): () => void {
  const canvas = plate.querySelector<HTMLCanvasElement>("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return () => {};

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dots: Dot[] = [];
  let width = 0;
  let height = 0;
  let frame = 0;
  let pointer: { x: number; y: number } | null = null;
  let stopped = false;

  function build() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    width = plate.clientWidth;
    height = plate.clientHeight;
    canvas!.width = Math.round(width * ratio);
    canvas!.height = Math.round(height * ratio);
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);

    // Set the text off screen as large as fits the plate, then read coverage.
    const mask = document.createElement("canvas");
    mask.width = Math.ceil(width);
    mask.height = Math.ceil(height);
    const ink = mask.getContext("2d", { willReadFrequently: true })!;
    ink.font = `900 100px Georgia, "Times New Roman", serif`;
    const measured = ink.measureText(text).width || 1;
    const size = Math.min(height * 0.92, (100 * width * 0.9) / measured);
    ink.font = `900 ${size}px Georgia, "Times New Roman", serif`;
    ink.textAlign = "center";
    ink.textBaseline = "middle";
    ink.fillText(text, width / 2, height / 2 + size * 0.04);
    const pixels = ink.getImageData(0, 0, mask.width, mask.height).data;

    // A 45-degree screen, as newsprint halftones are set: grid points are
    // rotated about the centre so the rows run on the diagonal.
    const cell = Math.max(4, Math.round(size / 46));
    const previous = dots;
    dots = [];
    const cos = Math.SQRT1_2;
    const reach = Math.hypot(width, height) / 2 + cell;
    for (let v = -reach; v < reach; v += cell) {
      for (let u = -reach; u < reach; u += cell) {
        const x = width / 2 + (u - v) * cos;
        const y = height / 2 + (u + v) * cos;
        if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) continue;
        // Coverage over the cell from a 3x3 sample.
        let covered = 0;
        for (let sy = -1; sy <= 1; sy++) {
          for (let sx = -1; sx <= 1; sx++) {
            const px = Math.min(mask.width - 1, Math.max(0, Math.round(x + (sx * cell) / 3)));
            const py = Math.min(mask.height - 1, Math.max(0, Math.round(y + (sy * cell) / 3)));
            covered += pixels[(py * mask.width + px) * 4 + 3] / 255;
          }
        }
        covered /= 9;
        if (covered < 0.08) continue;
        const r = (cell / 2) * Math.sqrt(covered) * 0.98;
        dots.push({ hx: x, hy: y, x, y, vx: 0, vy: 0, r });
      }
    }

    if (still) return;
    if (previous.length === 0) {
      // First print: every dot starts flung out from the middle.
      for (const dot of dots) {
        const angle = Math.random() * Math.PI * 2;
        const distance = (0.3 + Math.random()) * Math.max(width, height) * 0.6;
        dot.x = width / 2 + Math.cos(angle) * distance;
        dot.y = height / 2 + Math.sin(angle) * distance;
      }
    }
  }

  // Two inks. The red plate lags each dot by its speed, so moving dots
  // smear out of register and a dot at rest hides its red under the black.
  const red = getComputedStyle(document.documentElement).getPropertyValue("--hc-red").trim() || "#ec3750";

  function draw() {
    context!.clearRect(0, 0, width, height);
    context!.fillStyle = red;
    context!.beginPath();
    for (const dot of dots) {
      const lag = Math.abs(dot.vx) + Math.abs(dot.vy);
      if (lag < 0.05) continue;
      const x = dot.x - dot.vx * 2.2;
      const y = dot.y - dot.vy * 2.2;
      context!.moveTo(x + dot.r, y);
      context!.arc(x, y, dot.r, 0, Math.PI * 2);
    }
    context!.fill();
    context!.fillStyle = "#111";
    context!.beginPath();
    for (const dot of dots) {
      context!.moveTo(dot.x + dot.r, dot.y);
      context!.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    }
    context!.fill();
  }

  // Physics runs in fixed 60 Hz steps, so it moves at the same speed on a
  // 120 Hz phone and in a throttled tab.
  let last = 0;
  let carry = 0;

  function step(now: number) {
    frame = 0;
    carry = Math.min(carry + (last ? now - last : 1000 / 60), 250);
    last = now;
    // No step due this frame: keep going.
    let moving = true;
    while (carry >= 1000 / 60) {
      carry -= 1000 / 60;
      moving = tick();
    }
    draw();
    if (moving || pointer) frame = requestAnimationFrame(step);
    else last = 0;
  }

  function tick(): boolean {
    const radius = Math.min(140, width * 0.22);
    let moving = false;
    for (const dot of dots) {
      // Spring home, with damping.
      dot.vx += (dot.hx - dot.x) * 0.045;
      dot.vy += (dot.hy - dot.y) * 0.045;
      if (pointer) {
        const dx = dot.x - pointer.x;
        const dy = dot.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < radius && distance > 0.01) {
          const push = (1 - distance / radius) ** 2 * 6;
          dot.vx += (dx / distance) * push;
          dot.vy += (dy / distance) * push;
        }
      }
      dot.vx *= 0.82;
      dot.vy *= 0.82;
      dot.x += dot.vx;
      dot.y += dot.vy;
      if (Math.abs(dot.vx) + Math.abs(dot.vy) > 0.02 || Math.abs(dot.x - dot.hx) + Math.abs(dot.y - dot.hy) > 0.3) {
        moving = true;
      } else {
        dot.x = dot.hx;
        dot.y = dot.hy;
      }
    }
    return moving;
  }

  function wake() {
    if (!stopped && !still && !frame) frame = requestAnimationFrame(step);
  }

  function local(event: PointerEvent) {
    const box = canvas!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function onMove(event: PointerEvent) {
    pointer = local(event);
    wake();
  }

  function onLeave() {
    pointer = null;
    wake();
  }

  function onDown(event: PointerEvent) {
    const at = local(event);
    // A ring of ink knocked outward from where the plate was struck.
    for (const dot of dots) {
      const dx = dot.x - at.x;
      const dy = dot.y - at.y;
      const distance = Math.hypot(dx, dy) || 1;
      const push = Math.max(0, 1 - distance / (width * 0.5)) * 38;
      dot.vx += (dx / distance) * push * (0.6 + Math.random() * 0.8);
      dot.vy += (dy / distance) * push * (0.6 + Math.random() * 0.8);
    }
    if (event.pointerType !== "mouse") pointer = null;
    wake();
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      build();
      draw();
      wake();
    }, 120);
  }

  // Georgia may still be loading; set the text once it's in.
  void document.fonts.ready.then(() => {
    if (stopped) return;
    build();
    draw();
    plate.classList.add("is-drawn");
    wake();
  });

  if (!still) {
    plate.addEventListener("pointermove", onMove);
    plate.addEventListener("pointerleave", onLeave);
    plate.addEventListener("pointercancel", onLeave);
    plate.addEventListener("pointerdown", onDown);
  }
  addEventListener("resize", onResize);

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    clearTimeout(resizeTimer);
    removeEventListener("resize", onResize);
  };
}
