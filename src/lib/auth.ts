import { betterAuth, type User } from "better-auth";
import { genericOAuth } from "better-auth/plugins";

const configuredBaseURL =
  import.meta.env.BETTER_AUTH_URL ?? "http://localhost:4000";

// Every Vercel preview is its own origin, and Hack Club Auth sends the reader
// back to the origin the login started from. A single BETTER_AUTH_URL cannot
// name them all, so previews use the host of the request, within Vercel's
// preview domains. Production and local development keep the configured URL.
const baseURL =
  (process.env.VERCEL_ENV ?? import.meta.env.VERCEL_ENV) === "preview"
    ? {
        allowedHosts: ["*.hackclub.dev", "*.vercel.app"],
        protocol: "https" as const,
        fallback: configuredBaseURL,
      }
    : configuredBaseURL;
const configuredSecret =
  import.meta.env.BETTER_AUTH_SECRET ?? import.meta.env.AUTH_SECRET;

function createAuth() {
  if (import.meta.env.PROD && !configuredSecret) {
    throw new Error("BETTER_AUTH_SECRET must be configured in production");
  }

  return betterAuth({
    baseURL,
    secret:
      configuredSecret ?? "slacker-news-local-development-secret-please-change",
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "hackclub",
            discoveryUrl:
              "https://auth.hackclub.com/.well-known/openid-configuration",
            clientId: import.meta.env.HACKCLUB_CLIENT_ID ?? "",
            clientSecret: import.meta.env.HACKCLUB_CLIENT_SECRET ?? "",
            scopes: ["openid", "profile", "email", "slack_id"],
            pkce: true,
            requireIssuerValidation: false,
            // slackId is an additional user field the plugin's type can't see.
            mapProfileToUser: (profile) =>
              ({ slackId: profile.slack_id }) as Partial<User>,
          },
        ],
      }),
    ],
    user: {
      additionalFields: {
        slackId: { type: "string", required: false, input: false },
      },
    },
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
  return (authInstance ??= createAuth());
}
