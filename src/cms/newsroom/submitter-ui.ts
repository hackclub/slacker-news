/**
 * What the admin looks like to a submitter (anyone below Editor).
 *
 * The server already refuses everything a submitter may not do
 * (submitters.ts); this only takes the dead ends off the screen, so they see
 * their posts, the editor, and "Shared with me", and no button that would
 * answer with an error.
 */
const EDITOR = 40;

/** Menu entries that lead to pages a submitter cannot use. */
const HIDDEN_LINKS = [
  'a[href$="/_emdash/admin"]',
  'a[href$="/_emdash/admin/"]',
  'a[href*="/_emdash/admin/calendar"]',
  'a[href*="/content/changelogs"]',
  'a[href*="/content/pages"]',
  'a[href*="/_emdash/admin/media"]',
  'a[href*="/plugins/newsroom/queue"]',
  'a[href*="/plugins/newsroom/slack"]',
  'a[href*="/plugins/newsroom/calendar"]',
];
/**
 * Buttons for things only editors do, by how their label starts. (EmDash
 * writes some labels twice, for wide and narrow screens: "Publish nowPublish".)
 */
const HIDDEN_BUTTONS = /^(Approve|Publish|Schedule|Upload Media)/;

async function role(): Promise<number | undefined> {
  try {
    const response = await fetch("/_emdash/api/auth/me", {
      credentials: "same-origin",
    });
    const json = await response.json();
    const data = json?.data ?? json;
    return data?.role ?? data?.user?.role;
  } catch {
    return undefined;
  }
}

function tidy() {
  for (const button of document.querySelectorAll("button")) {
    if (HIDDEN_BUTTONS.test(button.textContent?.trim() ?? ""))
      button.style.display = "none";
  }
  // The dashboard is the editors' overview; a submitter starts at their posts.
  if (/\/_emdash\/admin\/?$/.test(window.location.pathname))
    window.location.replace("/_emdash/admin/content/posts");
}

async function start() {
  const mine = await role();
  if (mine === undefined || mine >= EDITOR) return;
  const style = document.createElement("style");
  style.textContent = `${HIDDEN_LINKS.join(", ")}, [data-newsroom-slot="body_format"], [data-newsroom-slot="members_only"] { display: none !important; }`;
  document.head.appendChild(style);
  tidy();
  new MutationObserver(tidy).observe(document.body, {
    childList: true,
    subtree: true,
  });
}

if (typeof document !== "undefined") void start();
