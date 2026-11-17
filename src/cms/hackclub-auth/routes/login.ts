import type { APIRoute } from "astro";
import { getPublicOrigin } from "emdash/api/route-utils";
import {
  AUTHORIZE_URL,
  CALLBACK_PATH,
  codeChallenge,
  credentials,
  PENDING_KEY,
  type PendingSignIn,
  randomToken,
  SCOPES,
} from "../oidc";

export const prerender = false;

const INVITE_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

function failure(message: string): string {
  return `/_emdash/admin/login?error=hackclub_error&message=${encodeURIComponent(message)}`;
}

/** GET /_emdash/api/auth/hackclub/login: sends the visitor to Hack Club Auth. */
export const GET: APIRoute = async ({ request, locals, session, redirect }) => {
  const client = credentials();
  if (!client) {
    return redirect(
      failure(
        "Hack Club sign-in is not configured. Set HACKCLUB_CLIENT_ID and HACKCLUB_CLIENT_SECRET.",
      ),
    );
  }
  if (!session)
    return redirect(failure("Sessions are not available on this server."));

  const url = new URL(request.url);
  const invite = url.searchParams.get("invite");
  const pending: PendingSignIn = {
    state: randomToken(),
    codeVerifier: randomToken(),
    redirectUri: `${getPublicOrigin(url, locals.emdash?.config)}${CALLBACK_PATH}`,
    inviteToken: invite && INVITE_TOKEN.test(invite) ? invite : undefined,
  };
  session.set(PENDING_KEY, pending);

  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: pending.redirectUri,
    scope: SCOPES,
    state: pending.state,
    code_challenge: await codeChallenge(pending.codeVerifier),
    code_challenge_method: "S256",
  }).toString();
  return redirect(authorize.toString());
};
