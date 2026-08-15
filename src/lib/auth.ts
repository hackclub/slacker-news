import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";

const baseURL = import.meta.env.BETTER_AUTH_URL ?? "http://localhost:4000";
const configuredSecret = import.meta.env.BETTER_AUTH_SECRET ?? import.meta.env.AUTH_SECRET;

function createAuth() {
  if (import.meta.env.PROD && !configuredSecret) {
    throw new Error("BETTER_AUTH_SECRET must be configured in production");
  }

  return betterAuth({
  baseURL,
  secret: configuredSecret ?? "slacker-news-local-development-secret-please-change",
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "hackclub",
          discoveryUrl: "https://auth.hackclub.com/.well-known/openid-configuration",
          clientId: import.meta.env.HACKCLUB_CLIENT_ID ?? "",
          clientSecret: import.meta.env.HACKCLUB_CLIENT_SECRET ?? "",
          scopes: ["openid", "profile", "email", "slack_id"],
          pkce: true,
          requireIssuerValidation: false,
        },
      ],
    }),
  ],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 12,
      strategy: "jwe",
      refreshCache: true,
    },
  },
  account: {
    storeAccountCookie: false,
    storeStateStrategy: "cookie",
  },
  });
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return authInstance ??= createAuth();
}
