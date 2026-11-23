import type { APIRoute } from "astro";
import {
  acceptInviteViaOAuth,
  findOrCreateOAuthUser,
  OAuthError,
  type OAuthProfile,
  Role,
} from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { finalizeSetup, OptionsRepository } from "emdash/api/route-utils";
import { sql, type Kysely } from "kysely";
import { fetchUser, PENDING_KEY, type PendingSignIn } from "../oidc";

export const prerender = false;

const PROVIDER = "hackclub";

function failure(code: string, message: string): string {
  return `/_emdash/admin/login?error=${code}&message=${encodeURIComponent(message)}`;
}

/** EMDASH_HACKCLUB_ADMINS: Slack IDs or email addresses, separated by commas. */
function isListedAdmin(
  profile: OAuthProfile,
  slackId: string | undefined,
): boolean {
  const listed = (process.env.EMDASH_HACKCLUB_ADMINS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (slackId && listed.includes(slackId.toLowerCase())) return true;
  return profile.emailVerified && listed.includes(profile.email.toLowerCase());
}

/** Kept in the newsroom plugin's storage, under `slackIds`. */
async function rememberSlackId(
  db: Kysely<never>,
  userId: string,
  slackId: string,
) {
  if (!/^[UW][A-Z0-9]{6,}$/.test(slackId)) return;
  const data = JSON.stringify({ slackId });
  await sql`
    insert into _plugin_storage (plugin_id, collection, id, data)
    values ('newsroom', 'slackIds', ${userId}, ${data})
    on conflict (plugin_id, collection, id)
    do update set data = excluded.data, updated_at = datetime('now')
  `.execute(db);
}

const MESSAGES: Record<string, string> = {
  signup_not_allowed:
    "Your Hack Club account does not have access to this CMS. Ask an administrator for an invite.",
  invite_invalid:
    "This invite link is invalid or has expired. Ask for a new one.",
  invite_email_mismatch:
    "This invite was sent to a different email address than your Hack Club account.",
  invite_email_unverified:
    "Verify your email address with Hack Club Auth, then try again.",
  user_not_found: "Your account was not found. It may have been deleted.",
};

/**
 * GET /_emdash/api/auth/hackclub/callback: Hack Club Auth sends the visitor
 * back here.
 *
 * Who gets in:
 * - someone whose Hack Club account is already linked to a CMS user;
 * - someone whose verified email matches an existing CMS user, or the invite
 *   they followed;
 * - anyone listed in EMDASH_HACKCLUB_ADMINS, as an administrator;
 * - while the site has no administrator yet: whoever signs in first, unless
 *   EMDASH_HACKCLUB_ADMINS is set, in which case only the people it lists;
 * - anyone else with a verified Hack Club email, as a Contributor (an external
 *   contributor). Editors can raise their role later.
 */
export const GET: APIRoute = async ({ request, locals, session, redirect }) => {
  const db = locals.emdash?.db;
  if (!db) return redirect(failure("server_error", "Database not configured"));
  if (!session)
    return redirect(
      failure("server_error", "Sessions are not available on this server."),
    );

  const params = new URL(request.url).searchParams;
  const error = params.get("error");
  if (error)
    return redirect(
      failure("oauth_denied", params.get("error_description") ?? error),
    );

  const pending = await session.get<PendingSignIn>(PENDING_KEY);
  session.delete(PENDING_KEY);
  const code = params.get("code");
  if (!code || !pending || params.get("state") !== pending.state) {
    return redirect(
      failure("invalid_state", "This sign-in expired. Please try again."),
    );
  }

  try {
    const hackClubUser = await fetchUser(code, pending);
    if (!hackClubUser.email) {
      return redirect(
        failure(
          "hackclub_error",
          "Your Hack Club account has no email address.",
        ),
      );
    }
    const profile: OAuthProfile = {
      id: hackClubUser.sub,
      email: hackClubUser.email,
      name: hackClubUser.name ?? null,
      avatarUrl: null,
      emailVerified: hackClubUser.email_verified === true,
    };

    // EmDash's database type and the auth adapter's describe the same tables
    // differently; EmDash's own providers cast here too.
    const adapter = createKyselyAdapter(
      db as unknown as Parameters<typeof createKyselyAdapter>[0],
    );
    const options = new OptionsRepository(db);
    const setupComplete = await options.get("emdash:setup_complete");
    const isFirstUser = setupComplete !== true && setupComplete !== "true";
    const adminsAreListed = Boolean(process.env.EMDASH_HACKCLUB_ADMINS?.trim());
    const listedAdmin = isListedAdmin(profile, hackClubUser.slack_id);

    const user = pending.inviteToken
      ? await acceptInviteViaOAuth(
          adapter,
          PROVIDER,
          profile,
          pending.inviteToken,
        )
      : await findOrCreateOAuthUser(
          adapter,
          PROVIDER,
          profile,
          async () =>
            listedAdmin || (isFirstUser && !adminsAreListed)
              ? { allowed: true, role: Role.ADMIN }
              : { allowed: true, role: Role.CONTRIBUTOR },
          { requireVerifiedEmail: true },
        );

    if (user.disabled)
      return redirect(failure("account_disabled", "Account disabled"));

    if (isFirstUser) {
      // Idempotent, so two first sign-ins racing each other is harmless.
      await finalizeSetup(db);
      console.log(
        `[hackclub-auth] Setup complete: ${user.email} is the first administrator`,
      );
    }

    // The newsroom plugin sends this person Slack messages about their
    // articles. A failure here must not stop the sign-in.
    if (hackClubUser.slack_id)
      await rememberSlackId(
        db as unknown as Kysely<never>,
        user.id,
        hackClubUser.slack_id,
      ).catch((e) =>
        console.warn("[hackclub-auth] Could not keep the Slack ID:", e),
      );

    session.set("user", { id: user.id });
    return redirect("/_emdash/admin");
  } catch (caught) {
    console.error("[hackclub-auth] Sign-in failed:", caught);
    const code = caught instanceof OAuthError ? caught.code : "hackclub_error";
    return redirect(
      failure(
        code,
        MESSAGES[code] ?? "Hack Club sign-in failed. Please try again.",
      ),
    );
  }
};
