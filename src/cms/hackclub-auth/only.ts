import type { APIContext } from "astro";

/**
 * Makes Hack Club Auth the only way into the EmDash admin.
 *
 * EmDash always offers passkeys and email links, and has no setting to turn
 * them off, so their endpoints are refused here instead. Invites still work:
 * the invited person accepts by signing in with Hack Club.
 */
const REFUSED = [
  "/_emdash/api/auth/passkey",
  "/_emdash/api/auth/magic-link/",
  "/_emdash/api/auth/signup/",
  "/_emdash/api/auth/oauth/",
  // Finishing an invite with a new passkey.
  "/_emdash/api/auth/invite/complete",
  "/_emdash/api/auth/invite/register-options",
  // Creating the first administrator with a passkey.
  "/_emdash/api/setup/admin/verify",
];

const LOGIN_PAGE = "/_emdash/admin/login";
const HACK_CLUB_LOGIN = "/_emdash/api/auth/hackclub/login";

/** Returns the response to send instead of the page, or nothing to carry on. */
export function hackClubOnly({
  url,
  redirect,
}: APIContext): Response | undefined {
  const path = url.pathname.replace(/\/$/, "");

  if (
    REFUSED.some(
      (prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix),
    )
  ) {
    return Response.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Sign in with Hack Club instead.",
        },
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  // EmDash's login page still shows its passkey button, so skip the page. It
  // is only shown to report a failed sign-in.
  if (path === LOGIN_PAGE && !url.searchParams.has("error")) {
    return redirect(HACK_CLUB_LOGIN);
  }
}
