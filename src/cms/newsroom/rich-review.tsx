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
 *  - Select text and a Comment button appears by the selection.
 *  - A Suggest switch at the end of the editor's toolbar turns on suggesting
 *    mode. In it, typing, deleting and pasting never change the text: each
 *    edit is kept as a suggestion, drawn as struck text with the new text
 *    beside it. An editor, or the article's author, accepts one (the text
 *    then changes, like any edit) or rejects it.
 *
 * Threads are stored by the newsroom plugin, the same ones its Review panel
 * lists. A thread finds its passage again by its quoted text (anchors.ts), so
 * edits above it, or by someone else editing at the same time, do not lose it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { anchorFor, findAnchor } from "./anchors";
import type { Anchor } from "./anchors";
import { docText, endPos, offsetAt, startPos } from "./doc-text";
import { mentionsPlugin } from "./mentions";
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
  registerPlugin(
    plugin: Plugin,
    place?: (plugin: Plugin, plugins: Plugin[]) => Plugin[],
  ): void;
};

function entryFromLocation(): Entry | null {
  const match = /\/content\/([^/]+)\/([^/?#]+)/.exec(window.location.pathname);
  if (!match || match[2] === "new") return null;
  return {
    collection: decodeURIComponent(match[1]),
    id: decodeURIComponent(match[2]),
  };
}

/** Line icons, drawn in the colour of the text around them. */
const ICON = {
  comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
};
const svg = (paths: string, size = 14) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none">${paths}</svg>`;

const key = new PluginKey<DecorationSet>("newsroomReview");
/** Marks a change to the text that suggesting mode lets through. */
const ALLOW = "newsroomAllow";

type Composer = {
  kind: "comment";
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
  /** Suggesting mode: edits do not change the text; they become suggestions. */
  suggesting = false;
  /** The suggestions made by typing here. While suggesting, these are the truth and the server follows. */
  mine: Thread[] = [];
  notice = "";
  private version = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private edits = 0;
  private sentEdits = 0;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private syncing = 0;
  /** Counts saves of my typed suggestions, to tell when an answer is out of date. */
  private epoch = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private localIds = 0;

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
    const epoch = this.epoch;
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
    // A list that was asked for before a save of my suggestions, and answered
    // after it, shows the threads as they were: drop it.
    if (body.op !== "sync" && epoch !== this.epoch) answer.threads = undefined;
    if (answer.threads) this.threads = answer.threads;
    if (answer.you) this.you = answer.you;
    // Take the server's copy of my typed suggestions, unless newer edits are
    // still on their way to it.
    const settled =
      this.syncTimer === undefined &&
      this.edits === this.sentEdits &&
      (body.op === "sync" || this.syncing === 0);
    if (answer.threads && settled)
      this.mine = this.threads.filter((thread) => this.isMine(thread));
    this.repaint();
    this.emit();
    return answer;
  }

  /** A suggestion I made by typing, still open. */
  isMine(thread: Thread): boolean {
    return (
      thread.kind === "suggestion" &&
      Boolean(thread.auto) &&
      thread.status === "open" &&
      thread.author === this.you?.id
    );
  }

  /** The threads to draw: while suggesting, my typed ones come from here, not the server. */
  shown(): Thread[] {
    return this.suggesting
      ? [...this.threads.filter((thread) => !this.isMine(thread)), ...this.mine]
      : this.threads;
  }

  say(text: string) {
    this.notice = text;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = "";
      this.emit();
    }, 3200);
    this.emit();
  }

  setSuggesting(on: boolean) {
    if (on === this.suggesting) return;
    if (on) this.mine = this.threads.filter((thread) => this.isMine(thread));
    else void this.flush();
    this.suggesting = on;
    this.active = null;
    this.composer = null;
    this.repaint();
    this.emit();
  }

  /** Sends my typed suggestions to the server, which keeps, adds and removes threads to match. */
  async flush() {
    clearTimeout(this.syncTimer);
    this.syncTimer = undefined;
    if (this.edits === this.sentEdits) return;
    this.sentEdits = this.edits;
    this.syncing += 1;
    this.epoch += 1;
    await this.call({
      op: "sync",
      changes: this.mine.map((thread) => ({
        quote: thread.quote,
        prefix: thread.prefix ?? "",
        suffix: thread.suffix ?? "",
        start: thread.start ?? 0,
        replacement: thread.replacement ?? "",
      })),
    });
    this.syncing -= 1;
    if (this.edits !== this.sentEdits) this.touch();
  }

  /** My typed suggestions changed: draw them now, save them shortly. */
  private touch() {
    this.edits += 1;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.flush(), 900);
    this.repaint();
    this.emit();
  }

  private where(thread: Thread, dt: DocText) {
    return findAnchor(dt.text, {
      quote: thread.quote,
      prefix: thread.prefix ?? "",
      suffix: thread.suffix ?? "",
      start: thread.start ?? 0,
    });
  }

  private add(dt: DocText, start: number, end: number, replacement: string) {
    this.mine.push({
      id: `local-${(this.localIds += 1)}`,
      entryId: this.entry.id,
      author: this.you?.id ?? "",
      authorName: "You",
      at: new Date().toISOString(),
      kind: "suggestion",
      auto: true,
      status: "open",
      body: "",
      resolved: false,
      replies: [],
      ...anchorFor(dt.text, start, end),
      replacement,
    });
  }

  private move(thread: Thread, dt: DocText, start: number, end: number) {
    Object.assign(thread, anchorFor(dt.text, start, end));
  }

  private caretTo(view: EditorView, pos: number) {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
    );
  }

  /** Suggesting mode: text typed or pasted over a selection, or at the caret. */
  typed(view: EditorView, from: number, to: number, text: string) {
    if (!text) return;
    const { doc } = view.state;
    const $from = doc.resolve(from);
    if (!$from.parent.isTextblock || !$from.sameParent(doc.resolve(to)))
      return this.say("Suggest within one paragraph at a time.");
    if ($from.parent.textContent === "")
      return this.say(
        "Suggestions need some text around them. Switch to Editing to write a new paragraph.",
      );
    const dt = docText(doc);
    const start = offsetAt(dt, from);
    const end = offsetAt(dt, to);
    if (start === end) {
      // Keep typing into the suggestion that ends at the caret.
      const open = this.mine.find(
        (thread) => this.where(thread, dt)?.end === start,
      );
      if (open) open.replacement = (open.replacement ?? "") + text;
      else this.add(dt, start, start, text);
    } else {
      this.add(dt, start, end, text);
      this.caretTo(view, to);
    }
    this.touch();
  }

  /** Suggesting mode: Backspace or Delete. */
  erase(view: EditorView, forward: boolean) {
    const { doc, selection } = view.state;
    const { from, to, empty, $from } = selection;
    if (!$from.parent.isTextblock) return;
    const dt = docText(doc);
    if (!empty) {
      if (!$from.sameParent(doc.resolve(to)))
        return this.say("Suggest within one paragraph at a time.");
      this.add(dt, offsetAt(dt, from), offsetAt(dt, to), "");
      this.caretTo(view, from);
      return this.touch();
    }
    const at = offsetAt(dt, from);
    const found = this.mine.map((thread) => ({
      thread,
      range: this.where(thread, dt),
    }));
    if (!forward) {
      // First take back text I suggested adding here.
      const typing = found.find(
        ({ thread, range }) => range?.end === at && thread.replacement,
      );
      if (typing) {
        const { thread, range } = typing;
        thread.replacement = (thread.replacement ?? "").slice(0, -1);
        if (!thread.replacement && range && range.start === range.end)
          this.mine = this.mine.filter((other) => other !== thread);
        return this.touch();
      }
      if ($from.parentOffset === 0 || !$from.nodeBefore?.isText) return;
      const growing = found.find(
        ({ thread, range }) =>
          range && range.start === at && range.end > at && !thread.replacement,
      );
      if (growing?.range)
        this.move(growing.thread, dt, at - 1, growing.range.end);
      else this.add(dt, at - 1, at, "");
      this.caretTo(view, from - 1);
    } else {
      if (
        $from.parentOffset === $from.parent.content.size ||
        !$from.nodeAfter?.isText
      )
        return;
      const growing = found.find(
        ({ thread, range }) =>
          range && range.end === at && range.start < at && !thread.replacement,
      );
      if (growing?.range)
        this.move(growing.thread, dt, growing.range.start, at + 1);
      else this.add(dt, at, at + 1, "");
      this.caretTo(view, from + 1);
    }
    this.touch();
  }

  /** Takes back a suggestion I made by typing. */
  async discard(id: string) {
    if (!this.suggesting)
      this.mine = this.threads.filter((thread) => this.isMine(thread));
    this.mine = this.mine.filter((thread) => thread.id !== id);
    this.active = null;
    this.touch();
    await this.flush();
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
    void this.flush();
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
.nr-icon { display: inline-flex; align-items: center; gap: 2px; margin: 0 2px; padding: 2px 5px; border: 0; border-radius: 10px; background: rgba(250, 204, 21, .9); color: #1a1a1a; font-size: 11px; line-height: 16px; vertical-align: text-top; cursor: pointer; user-select: none; }
.nr-icon.nr-s { background: rgba(34, 197, 94, .9); }
/* News stories are set one way; the alignment buttons do not apply. */
[data-emdash-editor-surface] button[aria-label="Align left"], [data-emdash-editor-surface] button[aria-label="Align center"], [data-emdash-editor-surface] button[aria-label="Align right"], [data-emdash-editor-surface] button[aria-label="Justify"] { display: none !important; }
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
  button.innerHTML =
    svg(suggestion ? ICON.pencil : ICON.comment, 11) +
    (count > 1 && !suggestion ? `<span>${count}</span>` : "");
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
  for (const thread of store.shown()) {
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
        // Before the caret, so typing continues after the suggested text.
        Decoration.widget(to, () => insertion(thread), {
          side: -1,
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
    // Suggesting mode leaves the text alone: only an accepted suggestion, or
    // another person's edit arriving through co-editing, may change it.
    filterTransaction: (tr) =>
      !(
        store.suggesting &&
        tr.docChanged &&
        !tr.getMeta(ALLOW) &&
        !tr.getMeta("y-sync$")
      ),
    props: {
      decorations: (state) => key.getState(state),
      handleTextInput: (view, from, to, text) => {
        if (!store.suggesting) return false;
        store.typed(view, from, to, text);
        return true;
      },
      handleKeyDown: (view, event) => {
        if (!store.suggesting) return false;
        if (event.ctrlKey || event.metaKey || event.altKey) return false;
        if (event.key === "Backspace" || event.key === "Delete") {
          store.erase(view, event.key === "Delete");
          return true;
        }
        // A plain character: taken here, before the browser puts it in the
        // page. (Text from an input method still arrives by handleTextInput.)
        if (event.key.length === 1 && !event.isComposing) {
          const { from, to } = view.state.selection;
          store.typed(view, from, to, event.key);
          return true;
        }
        if (event.key === "Enter") {
          store.say(
            "A new paragraph can't be suggested. Switch to Editing for that.",
          );
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        if (!store.suggesting) return false;
        const text = (event.clipboardData?.getData("text/plain") ?? "")
          .replace(/\s*\n+\s*/g, " ")
          .trim();
        const { from, to } = view.state.selection;
        store.typed(view, from, to, text);
        return true;
      },
      handleDrop: () => store.suggesting,
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
  let place: CSSProperties | null = null;
  try {
    const at = props.store.editor.view.coordsAtPos(props.pos);
    const width = 320;
    const left = Math.max(8, Math.min(at.left, window.innerWidth - width - 8));
    const below = window.innerHeight - at.bottom;
    // Under the passage when there is room; over it when the passage is low
    // on the screen, so the card's buttons are never past the bottom edge.
    place =
      below >= 280 || below >= at.top
        ? { left, top: at.bottom + 8, maxHeight: Math.max(160, below - 16) }
        : {
            left,
            bottom: window.innerHeight - at.top + 8,
            maxHeight: Math.max(160, at.top - 16),
          };
  } catch {
    // The place is gone from the document.
  }
  if (!place) return null;
  return <div style={{ ...card, ...place }}>{props.children}</div>;
}

function Composer(props: { store: Store; composer: Composer }) {
  const { store, composer } = props;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const post = async () => {
    setBusy(true);
    const answer = await store.call({
      op: "create",
      kind: "comment",
      anchor: composer.anchor,
      body: text,
    });
    setBusy(false);
    if (!answer.error) {
      store.composer = null;
      store.emit();
    }
  };

  return (
    <Near pos={composer.from} store={store}>
      <strong>Comment</strong>
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
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Write a comment"
        style={input}
      />
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
          disabled={busy || !text.trim()}
          onClick={post}
        >
          Comment
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
  // A suggestion typed a moment ago, not yet stored.
  const unsaved = thread.id.startsWith("local-");
  const mine = store.isMine(thread);

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
    view.dispatch(tr.setMeta(ALLOW, true));
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
      {thread.replies.map((item, index) => (
        <div
          key={index}
          style={{
            borderTop: "1px solid rgba(128,128,128,.3)",
            paddingTop: 6,
          }}
        >
          <strong>{item.authorName}</strong>{" "}
          <span style={quiet}>{when(item.at)}</span>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {item.body}
          </div>
        </div>
      ))}
      {unsaved ? (
        <div style={quiet}>Saving…</div>
      ) : (
        <textarea
          rows={2}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Reply"
          style={input}
        />
      )}
      {store.error && <div style={{ color: "#ef4444" }}>{store.error}</div>}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        {mine && (
          <button
            type="button"
            style={button}
            onClick={() => store.discard(thread.id)}
          >
            Discard
          </button>
        )}
        {!unsaved && (
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
        )}
        {suggestion && !unsaved && (
          <>
            <button type="button" style={button} onClick={() => decide(false)}>
              Reject
            </button>
            <button type="button" style={primary} onClick={() => decide(true)}>
              Accept
            </button>
          </>
        )}
        {!suggestion && (
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

  useEffect(() => {
    const read = () => {
      const { doc, selection } = store.editor.state;
      const { from, to, empty } = selection;
      // Only a selection of text can be commented on, not a selected block.
      const text = empty ? "" : doc.textBetween(from, to, "\n");
      setSelection(text.trim() ? { from, to } : null);
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
  const active = store.shown().find((thread) => thread.id === store.active);

  let toolbar: ReactNode = null;
  if (allowed && selection && !store.composer) {
    try {
      const at = store.editor.view.coordsAtPos(selection.from);
      const top = at.top - 40 < 8 ? at.bottom + 8 : at.top - 40;
      const begin = () => {
        const dt = docText(store.editor.state.doc);
        const start = offsetAt(dt, selection.from);
        const end = offsetAt(dt, selection.to);
        if (end <= start) return;
        store.active = null;
        store.composer = {
          kind: "comment",
          anchor: anchorFor(dt.text, start, end),
          from: selection.from,
        };
        store.error = "";
        store.emit();
      };
      toolbar = (
        <div
          style={{
            position: "fixed",
            zIndex: 2147481000,
            top,
            left: Math.max(8, at.left),
            pointerEvents: "auto",
          }}
          // Pressing the button must not move the selection out of the text.
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            style={{
              ...button,
              background: "Canvas",
              padding: "4px 8px",
              boxShadow: "0 4px 14px rgba(0,0,0,.3)",
            }}
            onClick={begin}
          >
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{ display: "inline-flex" }}
                dangerouslySetInnerHTML={{ __html: svg(ICON.comment) }}
              />
              Comment
            </span>
          </button>
        </div>
      );
    } catch {
      toolbar = null;
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
      {toolbar}
      {store.composer && <Composer store={store} composer={store.composer} />}
      {active && !store.composer && (
        <ThreadCard store={store} thread={active} />
      )}
      {store.notice && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 32,
            transform: "translateX(-50%)",
            zIndex: 2147482500,
            padding: "8px 14px",
            borderRadius: 8,
            background: "#111827",
            color: "#fff",
            fontSize: 13,
            boxShadow: "0 8px 24px rgba(0,0,0,.35)",
          }}
        >
          {store.notice}
        </div>
      )}
    </div>
  );
}

/**
 * The Editing / Suggesting switch, put at the end of the editor's own toolbar.
 * The toolbar is EmDash's, so the button is added to its row by hand, and put
 * back if EmDash redraws the row without it.
 */
function mountToggle(store: Store, surface: Element): () => void {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.dataset.newsroomSuggesting = "";
  toggle.addEventListener("mousedown", (event) => event.preventDefault());
  toggle.addEventListener("click", () =>
    store.setSuggesting(!store.suggesting),
  );
  const paint = () => {
    const on = store.suggesting;
    toggle.innerHTML = `${svg(ICON.pencil)}<span>${on ? "Suggesting" : "Suggest"}</span>`;
    toggle.title = on
      ? "Suggesting: your edits are shown as suggestions and do not change the text. Click to go back to editing."
      : "Switch to suggesting: your edits become suggestions for someone to accept.";
    toggle.setAttribute("aria-pressed", String(on));
    toggle.style.cssText = `display:inline-flex;align-items:center;gap:6px;flex:none;margin-left:6px;padding:0 10px;height:32px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;border:1px solid ${
      on ? "rgb(34,197,94)" : "rgba(128,128,128,.45)"
    };background:${on ? "rgba(34,197,94,.22)" : "transparent"};color:inherit;`;
    (surface as HTMLElement).style.boxShadow = on
      ? "0 0 0 2px rgba(34,197,94,.55)"
      : "";
  };
  const place = () => {
    const row = surface.querySelector(".emdash-editor-toolbar");
    if (row && toggle.parentElement !== row) row.appendChild(toggle);
  };
  paint();
  place();
  const unsubscribe = store.subscribe(paint);
  const watcher = new MutationObserver(place);
  watcher.observe(surface, { childList: true, subtree: true });
  return () => {
    unsubscribe();
    watcher.disconnect();
    toggle.remove();
    (surface as HTMLElement).style.boxShadow = "";
  };
}

// ---------------------------------------------------------------------------
// Finding the editor
// ---------------------------------------------------------------------------

const attached = new WeakSet<object>();

function attach(editor: EditorLike, element: HTMLElement) {
  if (attached.has(editor)) return;
  const entry = entryFromLocation();
  if (!entry) return;
  attached.add(editor);
  ensureStyle();

  const store = new Store(editor, entry);
  // First in line, so suggesting mode sees typing before the editor's own
  // shortcuts and input rules do.
  editor.registerPlugin(reviewPlugin(store), (plugin, plugins) => [
    plugin,
    ...plugins,
  ]);
  editor.registerPlugin(
    mentionsPlugin(() => !store.suggesting),
    (plugin, plugins) => [plugin, ...plugins],
  );
  const host = document.createElement("div");
  host.id = "newsroom-review-root";
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<Overlay store={store} />);
  const surface = element.closest("[data-emdash-editor-surface]");
  const unmountToggle = surface ? mountToggle(store, surface) : () => {};
  store.start();

  editor.on("destroy", () => {
    store.stop();
    unmountToggle();
    // Unmounting inside the editor's own teardown is not allowed.
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  });
}

function scan() {
  for (const element of document.querySelectorAll<
    HTMLElement & { editor?: EditorLike }
  >('[data-co-editing-field="body_rich"] .ProseMirror')) {
    if (element.editor) attach(element.editor, element);
  }
}

if (typeof document !== "undefined") {
  new MutationObserver(scan).observe(document.body, {
    childList: true,
    subtree: true,
  });
  scan();
}
