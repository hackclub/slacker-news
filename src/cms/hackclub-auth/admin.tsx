import * as React from "react";
import { LinkButton } from "@cloudflare/kumo";

/** Shown on the admin login page, the setup wizard and invite pages. */
export function LoginButton({ inviteToken }: { inviteToken?: string } = {}) {
  const href = inviteToken
    ? `/_emdash/api/auth/hackclub/login?invite=${encodeURIComponent(inviteToken)}`
    : "/_emdash/api/auth/hackclub/login";
  return (
    <LinkButton href={href} variant="outline" className="w-full justify-center">
      <img
        src="https://assets.hackclub.com/icon-rounded.svg"
        alt=""
        className="h-5 w-5"
      />
      <span>Hack Club</span>
    </LinkButton>
  );
}
