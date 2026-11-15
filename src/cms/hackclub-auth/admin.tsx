import { LinkButton } from "@cloudflare/kumo";
import * as React from "react";

/**
 * Shown on the admin login page, the setup wizard and invite pages.
 *
 * EmDash always draws its passkey and email-link sign-in next to provider
 * buttons and has no setting to remove them. Their endpoints are refused (see
 * only.ts), so this button also hides them rather than leave dead controls on
 * the page. If EmDash's markup changes, the worst case is that they reappear.
 */
export function LoginButton({ inviteToken }: { inviteToken?: string } = {}) {
  const marker = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    // EmDash puts provider buttons in a grid, beside its own sign-in options.
    const grid = marker.current?.closest(".grid");
    const options = grid?.parentElement;
    if (!grid || !options) return;
    for (const sibling of options.children) {
      if (sibling !== grid && sibling instanceof HTMLElement)
        sibling.style.display = "none";
    }
    // The line under the login card that tells people to use a passkey.
    const hint = options.parentElement?.nextElementSibling;
    if (hint instanceof HTMLElement && hint.tagName === "P")
      hint.style.display = "none";
  }, []);

  const href = inviteToken
    ? `/_emdash/api/auth/hackclub/login?invite=${encodeURIComponent(inviteToken)}`
    : "/_emdash/api/auth/hackclub/login";
  return (
    <>
      <span ref={marker} hidden />
      <LinkButton
        href={href}
        variant="outline"
        className="w-full justify-center"
      >
        <img
          src="https://assets.hackclub.com/icon-rounded.svg"
          alt=""
          className="h-5 w-5"
        />
        <span>Sign in with Hack Club</span>
      </LinkButton>
    </>
  );
}
