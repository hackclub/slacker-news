import express from "express";
import type { Request, Response, NextFunction } from "express";
import { auth, requiresAuth } from "express-openid-connect";

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

app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    req.path === "/login" ||
    req.path === "/callback" ||
    req.path === "/logout"
  ) {
    return next();
  }

  if (!req.oidc.isAuthenticated()) {
    res.send(`
      <html>
        <body>
          <h1>log in now</h1>
          <a href="/login">Sign in</a>
        </body>
      </html>
    `);
    return;
  }

  next();
});

app.use(express.static("dist"));

app.listen(PORT, () => console.log(`proxy: at http://localhost:${PORT}`));
