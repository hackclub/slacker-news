/** The parts of Hack Club Auth's OpenID Connect API the CMS login uses. */
const ISSUER = "https://auth.hackclub.com";
export const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const USERINFO_URL = `${ISSUER}/oauth/userinfo`;
export const SCOPES = "openid profile email slack_id";

export const CALLBACK_PATH = "/_emdash/api/auth/hackclub/callback";
/** Key in the visitor's session that holds a sign-in in progress. */
export const PENDING_KEY = "hackclub_oauth";

export type PendingSignIn = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  inviteToken?: string;
};

export type HackClubUser = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  slack_id?: string;
};

/** The CMS can have its own OAuth app, or share the one used for reader sign-in. */
export function credentials():
  | { clientId: string; clientSecret: string }
  | undefined {
  const clientId =
    process.env.EMDASH_OAUTH_HACKCLUB_CLIENT_ID ??
    process.env.HACKCLUB_CLIENT_ID;
  const clientSecret =
    process.env.EMDASH_OAUTH_HACKCLUB_CLIENT_SECRET ??
    process.env.HACKCLUB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return Buffer.from(digest).toString("base64url");
}

export async function fetchUser(
  code: string,
  pending: PendingSignIn,
): Promise<HackClubUser> {
  const client = credentials();
  if (!client) throw new Error("Hack Club Auth is not configured");

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: pending.codeVerifier,
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(
      `Hack Club Auth refused the code (${tokenResponse.status})`,
    );
  }
  const { access_token: accessToken } = (await tokenResponse.json()) as {
    access_token?: string;
  };
  if (!accessToken) throw new Error("Hack Club Auth returned no access token");

  const userResponse = await fetch(USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!userResponse.ok) {
    throw new Error(
      `Hack Club Auth refused the profile request (${userResponse.status})`,
    );
  }
  const user = (await userResponse.json()) as HackClubUser;
  if (!user.sub)
    throw new Error("Hack Club Auth returned a profile without an ID");
  return user;
}
