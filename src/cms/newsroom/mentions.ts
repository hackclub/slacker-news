/**
 * Slack people and channels, typed into a sentence.
 *
 * In the rich-text editor, type `@` and a few letters of a name, or `#` and a
 * channel's, and a list of matches from Slack opens at the caret (through the
 * newsroom plugin's `slack` route, which asks Flaron). Picking one puts
 * `@name` or `#channel` in the text as a link to it on Slack. That link is
 * all the editor stores; when the page is drawn, a link to a Slack person or
 * channel becomes the site's mention component (src/cms/rich/to-mdx.ts).
 */
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { channelUrl, userUrl } from "../rich/slack-links";

type Hit = { id: string; name: string; detail?: string };
type Trigger = {
  from: number;
  to: number;
  kind: "users" | "channels";
  query: string;
};

const ROUTE = "/_emdash/api/plugins/newsroom/slack";
const key = new PluginKey("newsroomMentions");

async function search(kind: Trigger["kind"], q: string): Promise<Hit[]> {
  try {
    const response = await fetch(ROUTE, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
      body: JSON.stringify({ kind, q }),
    });
    if (!response.ok) return [];
    const json = await response.json();
    return ((json?.data ?? json)?.hits ?? []) as Hit[];
  } catch {
    return [];
  }
}

/** The `@name` or `#name` being typed at the caret, if any. */
function triggerAt(view: EditorView): Trigger | null {
  const { selection, schema } = view.state;
  const { $from, empty } = selection;
  if (!empty || !$from.parent.isTextblock) return null;
  // Not inside a mention that is already there.
  if (
    schema.marks.link &&
    $from.marks().some((mark) => mark.type === schema.marks.link)
  )
    return null;
  const before = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "￼",
  );
  const match = /(?:^|[\s(])([@#])([\w.-]{2,30})$/.exec(before);
  if (!match) return null;
  const length = match[2].length + 1;
  return {
    from: $from.pos - length,
    to: $from.pos,
    kind: match[1] === "@" ? "users" : "channels",
    query: match[2],
  };
}

/** `enabled` is asked each time, so the list stays shut in suggesting mode. */
export function mentionsPlugin(enabled: () => boolean): Plugin {
  let trigger: Trigger | null = null;
  let hits: Hit[] = [];
  let active = 0;
  let ticket = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dismissed = "";
  const list = document.createElement("div");
  list.setAttribute("role", "listbox");
  list.dataset.newsroomMentions = "";
  Object.assign(list.style, {
    position: "fixed",
    zIndex: "2147483000",
    display: "none",
    minWidth: "260px",
    maxWidth: "360px",
    maxHeight: "240px",
    overflowY: "auto",
    background: "Canvas",
    color: "CanvasText",
    border: "1px solid rgba(128,128,128,.5)",
    borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,.3)",
    fontSize: "14px",
    padding: "4px",
  } satisfies Partial<CSSStyleDeclaration>);

  const hide = () => {
    list.style.display = "none";
    hits = [];
  };
  const open = () => list.style.display !== "none" && hits.length > 0;

  const pick = (view: EditorView, hit: Hit) => {
    if (!trigger) return;
    const { schema } = view.state;
    const users = trigger.kind === "users";
    const link = schema.marks.link?.create({
      href: users ? userUrl(hit.id) : channelUrl(hit.id),
    });
    if (!link) return;
    const text = `${users ? "@" : "#"}${hit.name}`;
    const tr = view.state.tr.replaceWith(
      trigger.from,
      trigger.to,
      schema.text(text, [link]),
    );
    // A plain space after it, so what is typed next is not part of the link.
    tr.insert(trigger.from + text.length, schema.text(" "));
    tr.removeStoredMark(schema.marks.link);
    view.dispatch(tr);
    hide();
    view.focus();
  };

  const draw = (view: EditorView) => {
    if (!trigger || hits.length === 0) return hide();
    const users = trigger.kind === "users";
    list.replaceChildren(
      ...hits.map((hit, index) => {
        const row = document.createElement("div");
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(index === active));
        const name = document.createElement("span");
        name.textContent = `${users ? "@" : "#"}${hit.name}`;
        name.style.fontWeight = "600";
        row.appendChild(name);
        if (hit.detail) {
          const detail = document.createElement("span");
          detail.textContent = hit.detail;
          detail.style.cssText = "opacity:.65;margin-left:8px";
          row.appendChild(detail);
        }
        Object.assign(row.style, {
          padding: "7px 10px",
          borderRadius: "7px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          background: index === active ? "rgba(37,99,235,.16)" : "transparent",
        });
        // mousedown, so the editor keeps its caret.
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          pick(view, hit);
        });
        return row;
      }),
    );
    const at = view.coordsAtPos(trigger.from);
    list.style.display = "block";
    list.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - 370))}px`;
    const below = window.innerHeight - at.bottom;
    if (below > 260) {
      list.style.top = `${at.bottom + 6}px`;
      list.style.bottom = "";
    } else {
      list.style.top = "";
      list.style.bottom = `${window.innerHeight - at.top + 6}px`;
    }
  };

  return new Plugin({
    key,
    view: (view) => {
      document.body.appendChild(list);
      return {
        update: () => {
          const next = enabled() && view.hasFocus() ? triggerAt(view) : null;
          const same =
            next &&
            trigger &&
            next.kind === trigger.kind &&
            next.query === trigger.query;
          trigger = next;
          if (!next) {
            dismissed = "";
            clearTimeout(timer);
            ticket += 1;
            return hide();
          }
          if (same || dismissed === `${next.kind}:${next.query}`) return;
          clearTimeout(timer);
          const mine = ++ticket;
          timer = setTimeout(async () => {
            const found = await search(next.kind, next.query);
            if (mine !== ticket) return;
            hits = found.slice(0, 8);
            active = 0;
            draw(view);
          }, 180);
        },
        destroy: () => {
          clearTimeout(timer);
          list.remove();
        },
      };
    },
    props: {
      handleKeyDown: (view, event) => {
        if (!open()) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          active =
            (active + (event.key === "ArrowDown" ? 1 : -1) + hits.length) %
            hits.length;
          draw(view);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          pick(view, hits[active]);
          return true;
        }
        if (event.key === "Escape") {
          if (trigger) dismissed = `${trigger.kind}:${trigger.query}`;
          hide();
          return true;
        }
        return false;
      },
    },
  });
}
