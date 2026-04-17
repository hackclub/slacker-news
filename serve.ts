import { serveStatic } from "bun";

Bun.serve({
  port: 80,
  fetch(req) {
    return serveStatic(req, { directory: "./dist" });
  },
});
