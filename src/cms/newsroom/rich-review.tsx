/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Comments and suggested edits on the rich-text editor.
 *
 * EmDash's rich-text editor (TipTap, on ProseMirror) is not open to plugins,
 * but it hands its live `editor` to the page (`.ProseMirror` elements carry it
 * as `.editor`). This registers a ProseMirror plugin on it, and nothing else of
 * the editor is changed:
 *
 *  - A passage with an open thread is highlighted, with a small icon at its
 *    end. Click either to open the thread.
 *  - Select text and a pair of buttons appears by the selection: Comment, and
 *    Suggest an edit. A suggestion shows the passage struck and the new text
 *    beside it; an editor, or the article's author, accepts it (the text
 *    changes in the editor, like any edit) or rejects it.
 *
 * Threads are stored by the newsroom plugin, the same ones its Review panel
 * lists. A thread finds its passage again by its quoted text (anchors.ts), so
 * edits above it, or by someone else editing at the same time, do not lose it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { anchorFor, findAnchor } from "./anchors";
import type { Anchor } from "./anchors";
import { docText, endPos, offsetAt, startPos } from "./doc-text";
import type { DocText } from "./doc-text";
import type { ReviewComment } from "./review";

const ROUTE = "/_emdash/api/plugins/newsroom/threads";
const AUTHOR_ROLE = 30;

type Thread = ReviewComment & { id: string };
type Answer = {
  threads?: Thread[];
  you?: { id: string; role: number };
  error?: string;
};
type Entry = { collection: string; id: string };

/** The parts of TipTap's editor this uses. */
type EditorLike = {
  state: EditorState;
  view: {
    state: EditorState;
    dispatch(tr: unknown): void;
    coordsAtPos(pos: number): {
      left: number;
      right: number;
      top: number;
      bottom: number;
    };
  };
  isDestroyed: boolean;
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
  registerPlugin(plugin: Plugin): void;
};

function entryFromLocation(): Entry | null {
  const match = /\/content\/([^/]+)\/([^/?#]+)/.exec(window.location.pathname);
  if (!match || match[2] === "new") return null;
  return {
    collection: decodeURIComponent(match[1]),
    id: decodeURIComponent(match[2]),
  };
}

const key = new PluginKey<DecorationSet>("newsroomReview");

type Composer = {
  kind: "comment" | "suggestion";
  anchor: Anchor;
  /** Where to draw it, from the selection. */
  from: number;
};

/** Everything about one editor's review state, shared by the plugin and the interface. */
class Store {
  threads: Thread[] = [];
  you: Answer["you"];
  error = "";
  active: string | null = null;
  composer: Composer | null = null;
  dt: DocText = { text: "", runs: [] };
  /** Where each open thread's passage is in the document now. */
  ranges = new Map<string, { from: number; to: number }>();
  private version = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly editor: EditorLike,
    readonly entry: Entry,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  emit() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Draws the highlights again, from the threads as they are now. */
  repaint() {
    if (this.editor.isDestroyed) return;
    const { view } = this.editor;
    view.dispatch(view.state.tr.setMeta(key, true));
  }

  async call(body: Record<string, unknown>): Promise<Answer> {
    let answer: Answer;
    try {
      const response = await fetch(ROUTE, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-EmDash-Request": "1",
        },
        body: JSON.stringify({
          ...body,
          collection: this.entry.collection,
          entryId: this.entry.id,
        }),
      });
      const json = await response.json().catch(() => null);
      answer = response.ok
        ? ((json?.data ?? json) as Answer)
        : { error: json?.error?.message ?? "The request failed." };
    } catch {
      answer = { error: "Could not reach the server." };
    }
    this.error = answer.error ?? "";
    if (answer.threads) this.threads = answer.threads;
    if (answer.you) this.you = answer.you;
    this.repaint();
    this.emit();
    return answer;
  }

  open(id: string | null) {
    this.active = id;
    this.composer = null;
    this.error = "";
    this.repaint();
    this.emit();
  }

  start() {
    void this.call({ op: "list" });
    this.timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void this.call({ op: "list" });
    }, 20_000);
  }

  stop() {
    clearInterval(this.timer);
  }
}

// ---------------------------------------------------------------------------
// The highlights
// ---------------------------------------------------------------------------

const STYLE = `
.nr-c { background: rgba(250, 204, 21, .28); border-bottom: 2px solid rgba(250, 204, 21, .7); cursor: pointer; }
.nr-c.nr-on { background: rgba(250, 204, 21, .5); }
.nr-del { background: rgba(239, 68, 68, .18); text-decoration: line-through; text-decoration-color: rgb(239, 68, 68); cursor: pointer; }
.nr-ins { margin-left: 2px; background: rgba(34, 197, 94, .2); text-decoration: underline; text-decoration-color: rgb(34, 197, 94); border-radius: 2px; }
.nr-on.nr-del { background: rgba(239, 68, 68, .32); }
.nr-icon { display: inline-flex; align-items: center; gap: 2px; margin: 0 2px; padding: 0 4px; border: 0; border-radius: 10px; background: rgba(250, 204, 21, .9); color: #1a1a1a; font-size: 11px; line-height: 16px; vertical-align: text-top; cursor: pointer; user-select: none; }
.nr-icon.nr-s { background: rgba(34, 197, 94, .9); }
`;

function ensureStyle() {
  if (document.getElementById("newsroom-review-style")) return;
  const style = document.createElement("style");
  style.id = "newsroom-review-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function insertion(thread: Thread): HTMLElement {
  const element = document.createElement("span");
  element.className = "nr-ins";
  element.contentEditable = "false";
  element.textContent = thread.replacement ?? "";
  return element;
}

function icon(store: Store, thread: Thread): HTMLElement {
  const suggestion = thread.kind === "suggestion";
  const button = document.createElement("button");
  button.type = "button";
  button.className = suggestion ? "nr-icon nr-s" : "nr-icon";
  button.contentEditable = "false";
  const count = thread.replies.length + 1;
  button.textContent = `${suggestion ? "✏️" : "💬"}${count > 1 && !suggestion ? ` ${count}` : ""}`;
  button.title = suggestion ? "Suggested edit" : "Comment";
  // The editor must keep its selection and focus.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () =>
    store.open(store.active === thread.id ? null : thread.id),
  );
  return button;
}

function build(store: Store, state: EditorState): DecorationSet {
  const dt = docText(state.doc);
  store.dt = dt;
  store.ranges.clear();
  const decorations: Decoration[] = [];
  for (const thread of store.threads) {
    const suggestion = thread.kind === "suggestion";
    if (suggestion ? thread.status !== "open" : thread.resolved) continue;
    // A general comment, made in the Review panel, is about no passage.
    if (!suggestion && !thread.quote) continue;
    const found = findAnchor(dt.text, {
      quote: thread.quote,
      prefix: thread.prefix ?? "",
      suffix: thread.suffix ?? "",
      start: thread.start ?? 0,
    });
    if (!found) continue;
    const from = startPos(dt, found.start);
    const to = found.end > found.start ? endPos(dt, found.end) : from;
    if (from === undefined || to === undefined) continue;
    const active = store.active === thread.id;
    store.ranges.set(thread.id, { from, to });
    if (from < to) {
      decorations.push(
        Decoration.inline(from, to, {
          class: `${suggestion ? "nr-del" : "nr-c"}${active ? " nr-on" : ""}`,
        }),
      );
    }
    if (suggestion && thread.replacement) {
      decorations.push(
        Decoration.widget(to, () => insertion(thread), {
          side: 1,
          key: `ins-${thread.id}-${thread.replacement}`,
        }),
      );
    }
    decorations.push(
      Decoration.widget(to, () => icon(store, thread), {
        side: 2,
        key: `icon-${thread.id}-${thread.replies.length}-${active}`,
      }),
    );
  }
  return DecorationSet.create(state.doc, decorations);
}

function reviewPlugin(store: Store): Plugin {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => build(store, state),
      apply: (tr, old, _before, state) =>
        tr.docChanged || tr.getMeta(key) ? build(store, state) : old,
    },
    props: {
      decorations: (state) => key.getState(state),
      handleClick: (_view, pos) => {
        for (const [id, range] of store.ranges) {
          if (pos >= range.from && pos <= range.to) {
            store.open(id);
            break;
          }
        }
        return false;
      },
    },
  });
}

// ---------------------------------------------------------------------------
// The interface: selection buttons, the composer and the thread card
// ---------------------------------------------------------------------------

const card: CSSProperties = {
  position: "fixed",
  zIndex: 2147482000,
  width: 320,
  maxHeight: "60vh",
  overflowY: "auto",
  padding: 12,
  borderRadius: 10,
  border: "1px solid rgba(128,128,128,.5)",
  background: "Canvas",
  color: "CanvasText",
  boxShadow: "0 10px 30px rgba(0,0,0,.35)",
  fontSize: 13,
  lineHeight: 1.45,
  display: "grid",
  gap: 8,
  pointerEvents: "auto",
};
const input: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid rgba(128,128,128,.5)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  resize: "vertical",
};
const button: CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid rgba(128,128,128,.5)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};
const primary: CSSProperties = {
  ...button,
  background: "#2563eb",
  borderColor: "#2563eb",
  color: "#fff",
};
const quiet: CSSProperties = { fontSize: 12, opacity: 0.7 };

function when(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/** A card near a place in the document, kept inside the window. */
function Near(props: { pos: number; store: Store; children: ReactNode }) {
  let place: { left: number; top: number } | null = null;
  try {
    const at = props.store.editor.view.coordsAtPos(props.pos);
    const width = 320;
    place = {
      left: Math.max(8, Math.min(at.left, window.innerWidth - width - 8)),
      top: Math.min(at.bottom + 8, window.innerHeight - 120),
    };
  } catch {
    // The place is gone from the document.
  }
  if (!place) return null;
  return <div style={{ ...card, ...place }}>{props.children}</div>;
}

function Composer(props: { store: Store; composer: Composer }) {
  const { store, composer } = props;
  const [text, setText] = useState(
    composer.kind === "suggestion" ? composer.anchor.quote : "",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const suggestion = composer.kind === "suggestion";

  const post = async () => {
    setBusy(true);
    const answer = await store.call({
      op: "create",
      kind: composer.kind,
      anchor: composer.anchor,
      ...(suggestion ? { replacement: text, body: note } : { body: text }),
    });
    setBusy(false);
    if (!answer.error) {
      store.composer = null;
      store.emit();
    }
  };
  const unchanged = suggestion && text === composer.anchor.quote;

  return (
    <Near pos={composer.from} store={store}>
      <strong>{suggestion ? "Suggest an edit" : "Comment"}</strong>
      <div
        style={{
          ...quiet,
          borderLeft: "3px solid rgba(250,204,21,.8)",
          paddingLeft: 8,
          overflowWrap: "anywhere",
        }}
      >
        {composer.anchor.quote}
      </div>
      <textarea
        autoFocus
        rows={suggestion ? 3 : 3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={
          suggestion ? "The text it should be instead" : "Write a comment"
        }
        style={input}
      />
      {suggestion && (
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why? (optional)"
          style={input}
        />
      )}
      {store.error && <div style={{ color: "#ef4444" }}>{store.error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          style={button}
          onClick={() => {
            store.composer = null;
            store.error = "";
            store.emit();
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          style={primary}
          disabled={busy || unchanged || (!suggestion && !text.trim())}
          onClick={post}
        >
          {suggestion ? "Suggest" : "Comment"}
        </button>
      </div>
    </Near>
  );
}

function ThreadCard(props: { store: Store; thread: Thread }) {
  const { store, thread } = props;
  const range = store.ranges.get(thread.id);
  const [reply, setReply] = useState("");
  const suggestion = thread.kind === "suggestion";
  if (!range) return null;

  const decide = async (accept: boolean) => {
    const here = store.ranges.get(thread.id);
    if (!here) return;
    // The server decides who may; the text changes only if it agrees.
    const answer = await store.call({ op: "decide", id: thread.id, accept });
    if (answer.error || !accept) return;
    const { view } = store.editor;
    const text = thread.replacement ?? "";
    const tr =
      here.from === here.to
        ? view.state.tr.insertText(text, here.from)
        : text
          ? view.state.tr.insertText(text, here.from, here.to)
          : view.state.tr.delete(here.from, here.to);
    view.dispatch(tr);
  };

  return (
    <Near pos={range.to} store={store}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div>
          <strong>{thread.authorName}</strong>{" "}
          <span style={quiet}>{when(thread.at)}</span>
        </div>
        <button
          type="button"
          aria-label="Close"
          style={{ ...button, border: 0, padding: "0 6px" }}
          onClick={() => store.open(null)}
        >
          ×
        </button>
      </div>
      {suggestion ? (
        <div style={{ overflowWrap: "anywhere" }}>
          {thread.quote && (
            <div
              style={{
                textDecoration: "line-through",
                background: "rgba(239,68,68,.18)",
              }}
            >
              {thread.quote}
            </div>
          )}
          {thread.replacement ? (
            <div style={{ background: "rgba(34,197,94,.2)" }}>
              {thread.replacement}
            </div>
          ) : (
            <div style={quiet}>Delete this text</div>
          )}
        </div>
      ) : (
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {thread.body}
        </div>
      )}
      {suggestion && thread.body && (
        <div style={{ whiteSpace: "pre-wrap" }}>{thread.body}</div>
      )}
      {thread.replies.map((item, index) => (
        <div
          key={index}
          style={{ borderTop: "1px solid rgba(128,128,128,.3)", paddingTop: 6 }}
        >
          <strong>{item.authorName}</strong>{" "}
          <span style={quiet}>{when(item.at)}</span>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {item.body}
          </div>
        </div>
      ))}
      <textarea
        rows={2}
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        placeholder="Reply"
        style={input}
      />
      {store.error && <div style={{ color: "#ef4444" }}>{store.error}</div>}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          style={button}
          disabled={!reply.trim()}
          onClick={async () => {
            const answer = await store.call({
              op: "reply",
              id: thread.id,
              body: reply,
            });
            if (!answer.error) setReply("");
          }}
        >
          Reply
        </button>
        {suggestion ? (
          <>
            <button type="button" style={button} onClick={() => decide(false)}>
              Reject
            </button>
            <button type="button" style={primary} onClick={() => decide(true)}>
              Accept
            </button>
          </>
        ) : (
          <button
            type="button"
            style={primary}
            onClick={async () => {
              const answer = await store.call({ op: "resolve", id: thread.id });
              if (!answer.error) store.open(null);
            }}
          >
            Resolve
          </button>
        )}
      </div>
    </Near>
  );
}

function Overlay(props: { store: Store }) {
  const { store } = props;
  useSyncExternalStore(store.subscribe, store.snapshot);
  const [selection, setSelection] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [, redraw] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () => {
      const { from, to, empty } = store.editor.state.selection;
      setSelection(empty ? null : { from, to });
    };
    const move = () => redraw((n) => n + 1);
    store.editor.on("selectionUpdate", read);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (store.composer || store.active) {
        store.composer = null;
        store.open(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      store.editor.off("selectionUpdate", read);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
      window.removeEventListener("keydown", escape);
    };
  }, [store]);

  const allowed = (store.you?.role ?? 0) >= AUTHOR_ROLE;
  const active = store.threads.find((thread) => thread.id === store.active);

  let toolbar: ReactNode = null;
  if (allowed && selection && !store.composer) {
    try {
      const at = store.editor.view.coordsAtPos(selection.from);
      const top = at.top - 40 < 8 ? at.bottom + 8 : at.top - 40;
      const begin = (kind: Composer["kind"]) => {
        const dt = docText(store.editor.state.doc);
        const start = offsetAt(dt, selection.from);
        const end = offsetAt(dt, selection.to);
        if (end <= start) return;
        store.active = null;
        store.composer = {
          kind,
          anchor: anchorFor(dt.text, start, end),
          from: selection.from,
        };
        store.error = "";
        store.emit();
      };
      const pill: CSSProperties = {
        ...button,
        background: "Canvas",
        padding: "4px 8px",
        boxShadow: "0 4px 14px rgba(0,0,0,.3)",
      };
      toolbar = (
        <div
          style={{
            position: "fixed",
            zIndex: 2147481000,
            top,
            left: Math.max(8, at.left),
            display: "flex",
            gap: 4,
            pointerEvents: "auto",
          }}
          // Pressing a button must not move the selection out of the text.
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" style={pill} onClick={() => begin("comment")}>
            💬 Comment
          </button>
          <button
            type="button"
            style={pill}
            onClick={() => begin("suggestion")}
          >
            ✏️ Suggest
          </button>
        </div>
      );
    } catch {
      toolbar = null;
    }
  }

  return (
    <div
      ref={root}
      style={{ position: "fixed", inset: 0, pointerEvents: "none" }}
    >
      {toolbar}
      {store.composer && <Composer store={store} composer={store.composer} />}
      {active && !store.composer && (
        <ThreadCard store={store} thread={active} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finding the editor
// ---------------------------------------------------------------------------

const attached = new WeakSet<object>();

function attach(editor: EditorLike) {
  if (attached.has(editor)) return;
  const entry = entryFromLocation();
  if (!entry) return;
  attached.add(editor);
  ensureStyle();

  const store = new Store(editor, entry);
  editor.registerPlugin(reviewPlugin(store));
  const element = document.createElement("div");
  element.id = "newsroom-review-root";
  document.body.appendChild(element);
  const root = createRoot(element);
  root.render(<Overlay store={store} />);
  store.start();

  editor.on("destroy", () => {
    store.stop();
    // Unmounting inside the editor's own teardown is not allowed.
    setTimeout(() => {
      root.unmount();
      element.remove();
    }, 0);
  });
}

function scan() {
  for (const element of document.querySelectorAll<
    HTMLElement & { editor?: EditorLike }
  >('[data-co-editing-field="body_rich"] .ProseMirror')) {
    if (element.editor) attach(element.editor);
  }
}

if (typeof document !== "undefined") {
  new MutationObserver(scan).observe(document.body, {
    childList: true,
    subtree: true,
  });
  scan();
}
