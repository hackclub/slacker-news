/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Moves a few fields of an article into the editor's sidebar.
 *
 * EmDash draws every schema field in the main column and gives a plugin no way
 * to place one in the sidebar. So the fields stay real form fields, which keeps
 * saving, drafts and co-editing as they are, but their widgets draw their
 * controls into a panel in the sidebar (`SidebarSlots`) and hide their own
 * place in the main column. If the panel is not on the page, the controls
 * stay where EmDash put them.
 *
 * Widgets here: the body format, the members-only switch, a picker of other
 * articles (for "Response to" and "Follow-up to"), and one that shows nothing.
 */
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

const box: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid rgba(128,128,128,.45)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: 13,
};
const heading: CSSProperties = { fontSize: 13, fontWeight: 600 };
const note: CSSProperties = { fontSize: 12, opacity: 0.7, lineHeight: 1.4 };

/** The sidebar section the widgets draw into. */
export function SidebarSlots() {
  const slot = (name: string) => <div data-newsroom-slot={name} />;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {slot("body_format")}
      {slot("members_only")}
      {slot("response_to")}
      {slot("follow_up_to")}
      <span style={note}>
        An article's address starts with its category (picked under Taxonomies),
        so changing the category moves it to a new address. Links to the old one
        stop working.
      </span>
    </div>
  );
}

/** The element a field's controls belong in, once the panel has drawn it. */
function useSlot(name: string): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () =>
      document.querySelector<HTMLElement>(`[data-newsroom-slot="${name}"]`);
    const sync = () => setElement(find());
    sync();
    const watcher = new MutationObserver(sync);
    watcher.observe(document.body, { childList: true, subtree: true });
    return () => watcher.disconnect();
  }, [name]);
  return element;
}

/**
 * Hides a field's place in the main column. EmDash marks each field's wrapper
 * with `data-co-editing-field`; if that ever changes, the field just stays
 * visible.
 */
function useHidden(field: string, hidden: boolean) {
  useEffect(() => {
    if (!hidden) return;
    const style = document.createElement("style");
    style.dataset.newsroomHidden = field;
    style.textContent = `[data-co-editing-field="${field}"] { display: none !important; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [field, hidden]);
}

/** Draws children in the sidebar slot, or in place if there is none. */
function InSidebar(props: { field: string; children: ReactNode }) {
  const slot = useSlot(props.field);
  // The panel mounts a moment after the form; wait before giving up on it.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  useHidden(props.field, Boolean(slot));
  if (slot) return createPortal(props.children, slot);
  return waited ? <>{props.children}</> : null;
}

type WidgetProps = {
  value: unknown;
  onChange: (value: never) => void;
  id?: string;
  options?: Record<string, unknown>;
};

/** Which of the two body fields is shown follows the body format. */
function useBodyFormat(format: string) {
  useHidden("body_rich", format !== "rich");
  useHidden("body", format === "rich");
}

export function BodyFormatField(props: WidgetProps) {
  const value = typeof props.value === "string" ? props.value : "mdx";
  useBodyFormat(value);
  const choices = [
    ["mdx", "MDX text"],
    ["rich", "Rich text"],
    ...(value === "slack" ? [["slack", "Slack message"]] : []),
  ];
  return (
    <InSidebar field="body_format">
      <label style={{ display: "grid", gap: 6 }}>
        <span style={heading}>Body format</span>
        <select
          value={value}
          onChange={(event) =>
            (props.onChange as (value: string) => void)(event.target.value)
          }
          style={box}
        >
          {choices.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span style={note}>
          Which body the article is made from. The other one is kept, hidden.
        </span>
      </label>
    </InSidebar>
  );
}

export function MembersOnlyField(props: WidgetProps) {
  // SQLite hands booleans back as 0 or 1.
  const on = props.value === true || props.value === 1;
  return (
    <InSidebar field="members_only">
      <div style={{ display: "grid", gap: 6 }}>
        <span style={heading}>Visibility</span>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={on}
            onChange={(event) =>
              (props.onChange as (value: boolean) => void)(event.target.checked)
            }
          />
          <span style={{ fontSize: 13 }}>Members only</span>
        </label>
        <span style={note}>
          Readers must sign in with Hack Club. Left out of the front page,
          archives, search and RSS for everyone else.
        </span>
      </div>
    </InSidebar>
  );
}

type Candidate = {
  id: string;
  /** EmDash's own id, to leave out the article being edited. */
  entryId: string;
  title: string;
  kind: string;
  date: string;
};

let candidates: Promise<Candidate[]> | undefined;

async function listAll(collection: string): Promise<Candidate[]> {
  const found: Candidate[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(
      `/_emdash/api/content/${collection}?${query}`,
      { credentials: "same-origin", headers: { "X-EmDash-Request": "1" } },
    );
    if (!response.ok) break;
    const json = await response.json();
    const data = json?.data ?? json;
    for (const item of data?.items ?? []) {
      const fields = item.data ?? {};
      // The slug alone: the site matches it to an article whatever its
      // category, so recategorising does not break the link.
      const id = String(item.slug);
      found.push({
        id,
        entryId: String(item.id),
        title: String(fields.title ?? item.slug),
        kind: collection === "posts" ? "post" : "changelog",
        date: String(fields.date ?? ""),
      });
    }
    cursor = data?.nextCursor ?? undefined;
  } while (cursor);
  return found;
}

function useCandidates(scope: string): Candidate[] {
  const [list, setList] = useState<Candidate[]>([]);
  useEffect(() => {
    candidates ??= Promise.all([listAll("posts"), listAll("changelogs")]).then(
      ([posts, changelogs]) =>
        [...posts, ...changelogs].sort((a, b) => b.date.localeCompare(a.date)),
    );
    let live = true;
    candidates
      .then((all) => live && setList(all))
      .catch(() => {
        candidates = undefined;
      });
    return () => {
      live = false;
    };
  }, []);
  return scope === "posts"
    ? list.filter((item) => item.kind !== "changelog")
    : list;
}

/** "a, b" in a text field is the list ["a", "b"]. */
function split(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function ArticlesField(props: WidgetProps) {
  const slot = String(props.options?.slot ?? "response_to");
  const scope = String(props.options?.scope ?? "posts");
  const title = String(props.options?.title ?? "Articles");
  const all = useCandidates(scope);
  const chosen = split(props.value);
  // Older values were written as `category/slug`; the slug is what counts.
  const key = (id: string) => id.split("/").pop() ?? id;
  const byId = useMemo(
    () => new Map(all.map((item) => [item.id, item])),
    [all],
  );
  const set = (next: string[]) =>
    (props.onChange as (value: string) => void)(next.join(", "));
  // An article cannot respond to itself. The editor's address names it.
  const self = /\/content\/[^/]+\/([^/?#]+)/.exec(
    window.location.pathname,
  )?.[1];
  const unused = all.filter(
    (item) =>
      !chosen.some((id) => key(id) === item.id) && item.entryId !== self,
  );

  return (
    <InSidebar field={slot}>
      <div style={{ display: "grid", gap: 6 }}>
        <span style={heading}>{title}</span>
        {chosen.map((id) => (
          <div
            key={id}
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              {byId.get(key(id))?.title ?? id}
            </span>
            <button
              type="button"
              aria-label={`Remove ${byId.get(key(id))?.title ?? id}`}
              onClick={() => set(chosen.filter((other) => other !== id))}
              style={{
                border: 0,
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                opacity: 0.7,
                fontSize: 16,
              }}
            >
              ×
            </button>
          </div>
        ))}
        <select
          value=""
          onChange={(event) =>
            event.target.value && set([...chosen, event.target.value])
          }
          style={box}
        >
          <option value="">
            {chosen.length ? "Add another…" : "Choose an article…"}
          </option>
          {unused.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
              {item.kind === "changelog" ? " (changelog)" : ""}
            </option>
          ))}
        </select>
      </div>
    </InSidebar>
  );
}

/** A field whose value is kept but never edited here. */
export function HiddenField(props: WidgetProps & { fieldName?: string }) {
  const name = String(props.options?.field ?? props.fieldName ?? "");
  useHidden(name, Boolean(name));
  return null;
}

export const sidebarWidgets = {
  "body-format": BodyFormatField,
  "members-only": MembersOnlyField,
  articles: ArticlesField,
  hidden: HiddenField,
};
