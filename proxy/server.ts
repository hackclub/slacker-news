import express from "express";
import type { Request, Response, NextFunction } from "express";
import { auth, requiresAuth } from "express-openid-connect";
import { readFileSync } from "fs";
import { join } from "path";

const LOGIN_PAGE = readFileSync(join(import.meta.dir, "login.html"), "utf-8");

const PUBLIC_PATHS = new Set<string>(
  readFileSync(join(import.meta.dir, "dist/whitelist.txt"), "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
);

const app = express();

const PORT = process.env.PORT || 7244;

app.use(
  auth({
    issuerBaseURL: "https://auth.hackclub.com",
    clientID: process.env.HCA_CLIENT_ID,
    clientSecret: process.env.HCA_CLIENT_SECRET,
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
    secret: process.env.SESSION_SECRET,
    authRequired: false,
    auth0Logout: false,
    authorizationParams: {
      response_type: "code",
      scope: "openid",
    },
  }),
);

app.get("/logo.svg", (_, res) =>
  res.sendFile(join(import.meta.dir, "logo.svg")),
);

app.use((req: Request, res: Response, next: NextFunction) => {
  const path = decodeURIComponent(req.path);
  if (!path.endsWith("/") && !path.includes(".")) {
    return res.redirect(301, path + "/");
  }
  if (PUBLIC_PATHS.has(path) || path.startsWith("/assets/")) {
    return next();
  }

  if (!req.oidc.isAuthenticated()) {
    res.send(LOGIN_PAGE);
    return;
  }

  next();
});

app.use(express.static("dist"));

app.listen(PORT, () => console.log(`proxy: at http://localhost:${PORT}`));
