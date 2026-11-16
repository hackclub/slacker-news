/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * The article text editor with comments and suggestions.
 *
 * EmDash draws a field with this component when the field's widget is
 * "newsroom:review-text" (set on the body of each post in the seed). It is a
 * plain text box with a highlight layer behind it, in two modes:
 *
 *  - Editing: the box changes the article. Select text and a small pair of
 *    buttons appears beside it: Comment, and Suggest an edit. Passages with an
 *    open thread are highlighted.
 *  - Suggesting: typing never changes the article. Each edit is kept as a
 *    suggestion: text taken out stays, struck through, and text put in is
 *    marked. An editor accepts or rejects them (see tracking.ts).
 *
 * In EmDash's distraction-free mode, which hides its sidebar, the threads
 * show beside the text instead of below it.
 *
 * Threads are stored by the newsroom plugin and shared with its Review panel.
 * They find their passage again by its quoted text, so edits above them do not
 * lose them (see anchors.ts).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  anchorFor,
  applyReplacement,
  findAnchor,
  marksAt,
  pieces,
} from "./anchors";
import type { Anchor } from "./anchors";
import type { ReviewComment } from "./review";
import {
  applyEdit,
  changesOf,
  diffEdit,
  fromSuggestions,
  mergedText,
  toBase,
  toShown,
} from "./tracking";
import type { Placed, Segment } from "./tracking";

type Thread = ReviewComment & { id: string };
type Answer = {
  threads?: Thread[];
  you?: { id: string; role: number };
  error?: string;
};
type Entry = { collection: string; id: string };
type Mode = "edit" | "suggest";

const ROUTE = "/_emdash/api/plugins/newsroom/threads";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const LINE = 1.55;
const PAD = 12;
const SYNC_DELAY = 1200;
const COMMENT_COLOR = "rgba(250, 204, 21, 0.4)";
const SUGGEST_COLOR = "rgba(59, 130, 246, 0.3)";
const INSERT_COLOR = "rgba(34, 197, 94, 0.3)";
const DELETE_COLOR = "rgba(239, 68, 68, 0.18)";
const ACTIVE_RING = "0 0 0 2px rgba(99, 102, 241, 0.9)";

/** The article being edited, read from the admin's address. */
function entryFromLocation(): Entry | null {
  const match = /\/content\/([^/]+)\/([^/?#]+)/.exec(window.location.pathname);
  if (!match || match[2] === "new") return null;
  return {
    collection: decodeURIComponent(match[1]),
    id: decodeURIComponent(match[2]),
  };
}

async function call(
  entry: Entry,
  body: Record<string, unknown>,
): Promise<Answer> {
  try {
    const response = await fetch(ROUTE, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
      body: JSON.stringify({
        ...body,
        collection: entry.collection,
        entryId: entry.id,
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok)
      return { error: json?.error?.message ?? "The request failed." };
    return (json?.data ?? json) as Answer;
  } catch {
    return { error: "Could not reach the server." };
  }
}

/**
 * Where a character of the box's text is drawn, in pixels from the box's top
 * left. A text box does not say, so the text up to it is laid out in a hidden
 * copy with the same type and width.
 */
function pointAt(
  el: HTMLTextAreaElement,
  index: number,
): { left: number; top: number } {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  const border =
    parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    boxSizing: "border-box",
    width: `${el.clientWidth + (Number.isFinite(border) ? border : 0)}px`,
    padding: style.padding,
    border: style.border,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    tabSize: style.tabSize,
  });
  mirror.textContent = el.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const point = {
    left: marker.offsetLeft,
    top: marker.offsetTop - el.scrollTop,
  };
  mirror.remove();
  return point;
}

const box: CSSProperties = {
  border: "1px solid rgba(128, 128, 128, 0.35)",
  borderRadius: 8,
  padding: 10,
  fontSize: 13,
  lineHeight: 1.45,
};
const small: CSSProperties = { fontSize: 12, opacity: 0.7 };
const button: CSSProperties = {
  border: "1px solid rgba(128, 128, 128, 0.5)",
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  padding: "3px 10px",
  fontSize: 12,
  cursor: "pointer",
};
const primary: CSSProperties = {
  ...button,
  background: "rgba(99, 102, 241, 1)",
  border: "1px solid rgba(99, 102, 241, 1)",
  color: "white",
};
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid rgba(128, 128, 128, 0.4)",
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  padding: 6,
  fontSize: 13,
  fontFamily: "inherit",
};
const iconButton: CSSProperties = {
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  width: 30,
  height: 28,
  fontSize: 16,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function Quote({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        ...small,
        borderLeft: "3px solid rgba(128,128,128,.5)",
        paddingLeft: 8,
        margin: "4px 0",
        whiteSpace: "pre-wrap",
      }}
    >
      {children}
    </div>
  );
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** One thread: the passage, what was said or proposed, replies and actions. */
function ThreadCard(props: {
  thread: Thread;
  attached: boolean;
  active: boolean;
  busy: boolean;
  onShow: () => void;
  onAct: (body: Record<string, unknown>) => void;
}) {
  const { thread, attached, active, busy, onShow, onAct } = props;
  const [reply, setReply] = useState("");
  const suggestion = thread.kind === "suggestion";
  const open = suggestion ? thread.status === "open" : !thread.resolved;
  const sendReply = () => {
    if (!reply.trim()) return;
    onAct({ op: "reply", id: thread.id, body: reply });
    setReply("");
  };
  return (
    <div
      data-thread={thread.id}
      style={{
        ...box,
        outline: active ? "2px solid rgba(99,102,241,.8)" : "none",
        opacity: open ? 1 : 0.65,
      }}
    >
      <div style={small}>
        {suggestion ? "Suggestion" : "Comment"} by {thread.authorName} ·{" "}
        {when(thread.at)}
        {!open && suggestion ? ` · ${thread.status}` : ""}
        {!open && !suggestion ? " · resolved" : ""}
      </div>
      {thread.quote && (
        <Quote>
          {thread.quote}
          {!attached && open ? " (text has changed)" : ""}
        </Quote>
      )}
      {suggestion && (
        <div style={{ whiteSpace: "pre-wrap" }}>
          {!thread.quote ? (
            <>
              Add{" "}
              <ins style={{ background: INSERT_COLOR, textDecoration: "none" }}>
                {thread.replacement}
              </ins>
              {!attached && open ? " (text has changed)" : ""}
            </>
          ) : thread.replacement ? (
            <>
              Change to:{" "}
              <ins style={{ background: INSERT_COLOR, textDecoration: "none" }}>
                {thread.replacement}
              </ins>
            </>
          ) : (
            <del>Delete this passage.</del>
          )}
        </div>
      )}
      {thread.body && (
        <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>
          {thread.body}
        </div>
      )}
      {thread.replies.map((r, i) => (
        <div
          key={i}
          style={{
            marginTop: 6,
            paddingLeft: 8,
            borderLeft: "2px solid rgba(128,128,128,.3)",
            whiteSpace: "pre-wrap",
          }}
        >
          <strong>{r.authorName}</strong> {r.body}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {attached && (
          <button type="button" style={button} onClick={onShow}>
            Show in text
          </button>
        )}
        {suggestion && thread.status === "open" ? (
          <>
            <button
              type="button"
              style={primary}
              disabled={busy || !attached}
              onClick={() => onAct({ op: "accept", id: thread.id })}
            >
              Accept
            </button>
            <button
              type="button"
              style={button}
              disabled={busy}
              onClick={() =>
                onAct({ op: "decide", id: thread.id, accept: false })
              }
            >
              Reject
            </button>
          </>
        ) : (
          !suggestion && (
            <button
              type="button"
              style={button}
              disabled={busy}
              onClick={() => onAct({ op: "resolve", id: thread.id })}
            >
              {thread.resolved ? "Reopen" : "Resolve"}
            </button>
          )
        )}
      </div>
      {open && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input
            style={input}
            placeholder="Reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendReply();
            }}
          />
          <button
            type="button"
            style={button}
            disabled={busy || !reply.trim()}
            onClick={sendReply}
          >
            Reply
          </button>
        </div>
      )}
    </div>
  );
}

/** What a stretch of the highlight layer stands for. */
type Mark = { kind: "comment" | "suggest" | "del" | "ins"; ref?: string };

export function ReviewTextField(props: {
  value: unknown;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  required?: boolean;
  options?: Record<string, unknown>;
}) {
  const text = typeof props.value === "string" ? props.value : "";
  const rows =
    typeof props.options?.rows === "number" ? props.options.rows : 30;
  const entry = useMemo(entryFromLocation, []);

  const root = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [you, setYou] = useState<{ id: string; role: number }>();
  const [selection, setSelection] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  const [scroll, setScroll] = useState(0);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [composer, setComposer] = useState<{
    kind: "comment" | "suggestion";
    anchor: Anchor;
    body: string;
    replacement: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("edit");
  const [segs, setSegs] = useState<Segment[] | null>(null);
  const [beside, setBeside] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [, redraw] = useState(0);

  // EmDash's distraction-free mode hides its sidebar; the threads move here.
  useEffect(() => {
    const check = () =>
      setFullscreen(Boolean(root.current?.closest(".fixed.inset-0")));
    check();
    const timer = setInterval(check, 400);
    return () => clearInterval(timer);
  }, []);
  const side = fullscreen || beside;
  const height = fullscreen
    ? "calc(100vh - 150px)"
    : Math.round(rows * 13 * LINE + PAD * 2);

  const apply = useCallback((answer: Answer) => {
    if (answer.error) setMessage(answer.error);
    else setMessage("");
    if (answer.threads) setThreads(answer.threads);
    if (answer.you) setYou(answer.you);
  }, []);

  // Load the threads, and look again now and then for those of other people.
  useEffect(() => {
    if (!entry) return;
    let stopped = false;
    const load = () =>
      call(entry, { op: "list" }).then((answer) => {
        if (!stopped && !answer.error) apply(answer);
      });
    load();
    const timer = setInterval(load, 20000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [entry, apply]);

  // Where each thread sits in the article as it is now.
  const placed = useMemo(
    () =>
      threads.map((thread) => {
        const open =
          thread.kind === "suggestion"
            ? thread.status === "open"
            : !thread.resolved;
        const found =
          thread.quote || thread.kind === "suggestion"
            ? findAnchor(text, {
                quote: thread.quote,
                prefix: thread.prefix ?? "",
                suffix: thread.suffix ?? "",
                start: thread.start ?? 0,
              })
            : undefined;
        return { thread, open, found };
      }),
    [threads, text],
  );

  // Open suggestions, drawn into the text for suggesting mode.
  const drawnIn = useMemo<Placed[]>(
    () =>
      placed.flatMap(({ thread, open, found }) =>
        open && thread.kind === "suggestion" && found
          ? [
              {
                ref: thread.id,
                start: found.start,
                end: found.end,
                replacement: thread.replacement ?? "",
                mine: Boolean(thread.auto) && thread.author === you?.id,
              },
            ]
          : [],
      ),
    [placed, you?.id],
  );
  const drawnKey = useMemo(() => JSON.stringify(drawnIn), [drawnIn]);

  const edits = useRef({
    version: 0,
    dirty: false,
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
  });
  const pendingCaret = useRef<number | null>(null);
  const lastInput = useRef("");

  // Rebuild the shown text from the article and its suggestions, unless the
  // writer has changes the server has not seen yet.
  useEffect(() => {
    if (mode !== "suggest" || edits.current.dirty) return;
    setSegs(fromSuggestions(text, drawnIn));
    // drawnKey stands for drawnIn.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, text, drawnKey]);

  const current = useMemo(
    () =>
      mode === "suggest" ? (segs ?? fromSuggestions(text, drawnIn)) : null,
    [mode, segs, text, drawnIn],
  );
  const segRef = useRef<Segment[] | null>(null);
  segRef.current = current;
  const shownText = current ? mergedText(current) : text;
  const shownRef = useRef(shownText);
  shownRef.current = shownText;

  // Marks on the highlight layer, in positions of the shown text.
  const { ranges, marks } = useMemo(() => {
    const list: { id: string; start: number; end: number }[] = [];
    const table = new Map<string, Mark>();
    if (current) {
      let at = 0;
      current.forEach((segment, i) => {
        const end = at + segment.text.length;
        if (segment.kind !== "keep") {
          const id = `seg:${i}`;
          list.push({ id, start: at, end });
          table.set(id, { kind: segment.kind, ref: segment.ref });
        }
        at = end;
      });
    }
    for (const { thread, open, found } of placed) {
      if (!open || !found || found.start === found.end) continue;
      if (current && thread.kind === "suggestion") continue;
      const start = current
        ? toShown(current, found.start, "start")
        : found.start;
      const end = current ? toShown(current, found.end, "end") : found.end;
      if (end <= start) continue;
      const id = `thread:${thread.id}`;
      list.push({ id, start, end });
      table.set(id, {
        kind: thread.kind === "suggestion" ? "suggest" : "comment",
        ref: thread.id,
      });
    }
    return { ranges: list, marks: table };
  }, [current, placed]);
  const drawn = useMemo(() => pieces(shownText, ranges), [shownText, ranges]);

  const syncScroll = () => {
    if (area.current && backdrop.current) {
      backdrop.current.scrollTop = area.current.scrollTop;
      backdrop.current.scrollLeft = area.current.scrollLeft;
      setScroll(area.current.scrollTop);
    }
  };

  const noteSelection = () => {
    const el = area.current;
    if (!el) return;
    const start = Math.min(el.selectionStart, el.selectionEnd);
    const end = Math.max(el.selectionStart, el.selectionEnd);
    setSelection({ start, end });
    // A click inside a highlight opens its thread.
    if (start === end) {
      const refs = marksAt(ranges, start)
        .map((id) => marks.get(id)?.ref)
        .filter((ref): ref is string => Boolean(ref));
      setActiveIds([...new Set(refs)]);
    } else setActiveIds([]);
  };

  // After the box is redrawn from tracked text, put the caret where typing left it.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null || !area.current) return;
    pendingCaret.current = null;
    area.current.setSelectionRange(caret, caret);
  });

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      if (!entry) return false;
      setBusy(true);
      const answer = await call(entry, body);
      setBusy(false);
      apply(answer);
      return !answer.error;
    },
    [entry, apply],
  );

  // Keep the writer's changes stored as suggestions.
  const flush = useCallback(async () => {
    clearTimeout(edits.current.timer);
    const list = segRef.current;
    if (!entry || !list || !edits.current.dirty) return;
    const version = edits.current.version;
    const answer = await call(entry, { op: "sync", changes: changesOf(list) });
    apply(answer);
    if (edits.current.version === version) edits.current.dirty = false;
  }, [entry, apply]);

  useEffect(
    () => () => {
      // Leaving the page: send what is left.
      void flush();
    },
    [flush],
  );

  const switchMode = async (next: Mode) => {
    if (next === mode) return;
    if (mode === "suggest") await flush();
    edits.current.dirty = false;
    setSegs(null);
    setMode(next);
  };

  /** One edit to the shown text, from the box's own input events. */
  const commit = useCallback(
    (from: number, to: number, inserted: string, type: string) => {
      const list = segRef.current;
      if (!list) return false;
      const result = applyEdit(list, from, to, inserted);
      if (!result) {
        setMessage(
          "That text belongs to another suggestion. Accept or reject it first.",
        );
        redraw((n) => n + 1);
        return false;
      }
      setMessage("");
      edits.current.dirty = true;
      edits.current.version++;
      pendingCaret.current =
        type === "deleteContentBackward" ? result.before : result.after;
      setSegs(result.segments);
      clearTimeout(edits.current.timer);
      edits.current.timer = setTimeout(flush, SYNC_DELAY);
      return true;
    },
    [flush],
  );

  // In suggesting mode typing is turned into marks before the box changes.
  useEffect(() => {
    const el = area.current;
    if (!el || mode !== "suggest") return;
    const handle = (event: InputEvent) => {
      if (event.isComposing) return;
      const type = event.inputType;
      lastInput.current = type;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const length = shownRef.current.length;
      let range: [number, number, string] | null = null;
      if (type === "insertText" || type === "insertReplacementText")
        range = [start, end, event.data ?? ""];
      else if (type === "insertLineBreak" || type === "insertParagraph")
        range = [start, end, "\n"];
      else if (type === "insertFromPaste" || type === "insertFromDrop")
        range = [
          start,
          end,
          event.dataTransfer?.getData("text/plain") ?? event.data ?? "",
        ];
      else if (type === "deleteByCut") range = [start, end, ""];
      else if (type === "deleteContentBackward")
        range =
          start !== end
            ? [start, end, ""]
            : start > 0
              ? [start - 1, start, ""]
              : null;
      else if (type === "deleteContentForward")
        range =
          start !== end
            ? [start, end, ""]
            : start < length
              ? [start, start + 1, ""]
              : null;
      else return; // Anything else goes through onChange, as a comparison of the texts.
      event.preventDefault();
      if (range) commit(range[0], range[1], range[2], type);
    };
    el.addEventListener("beforeinput", handle);
    return () => el.removeEventListener("beforeinput", handle);
  }, [mode, commit]);

  const show = (id: string) => {
    const found = placed.find((p) => p.thread.id === id)?.found;
    const el = area.current;
    if (!found || !el) return;
    setActiveIds([id]);
    const start = current
      ? toShown(current, found.start, "start")
      : found.start;
    const end = current ? toShown(current, found.end, "end") : found.end;
    el.focus();
    el.setSelectionRange(start, Math.max(start, end));
    const line = shownText.slice(0, start).split("\n").length;
    el.scrollTop = Math.max(0, (line - 3) * 13 * LINE);
    syncScroll();
  };

  // Where the selection is in the article itself, not in the shown text.
  const selected = () => {
    if (current) {
      const a = toBase(current, selection.start);
      const b = toBase(current, selection.end);
      return { start: Math.min(a, b), end: Math.max(a, b) };
    }
    return selection;
  };

  const begin = (kind: "comment" | "suggestion") => {
    const { start, end } = selected();
    if (start === end) return;
    const anchor = anchorFor(text, start, end);
    setComposer({ kind, anchor, body: "", replacement: anchor.quote });
  };

  const post = async () => {
    if (!composer) return;
    const ok = await send({
      op: "create",
      kind: composer.kind,
      anchor: composer.anchor,
      body: composer.body,
      replacement:
        composer.kind === "suggestion" ? composer.replacement : undefined,
    });
    if (ok) setComposer(null);
  };

  const act = async (body: Record<string, unknown>) => {
    if (body.op !== "accept") {
      await send(body);
      return;
    }
    // The server records the decision; the text changes here, unsaved.
    const thread = threads.find((t) => t.id === body.id);
    if (!thread) return;
    const next = applyReplacement(
      text,
      {
        quote: thread.quote,
        prefix: thread.prefix ?? "",
        suffix: thread.suffix ?? "",
        start: thread.start ?? 0,
      },
      thread.replacement ?? "",
    );
    if (next === undefined) {
      setMessage(
        "The passage has changed, so this suggestion cannot be applied.",
      );
      return;
    }
    if (await send({ op: "decide", id: thread.id, accept: true })) {
      props.onChange(next);
      setMessage(
        "Suggestion applied to the text. Save the article to keep it.",
      );
    }
  };

  const hasSelection = selection.start !== selection.end;
  const picked = selected();
  const canComment = hasSelection && picked.start !== picked.end;
  const open = placed.filter((p) => p.open);
  const closed = placed.filter((p) => !p.open);
  const canReview = Boolean(entry) && (you?.role ?? 30) >= 30;

  // The buttons that appear beside a selection: above its start, or below its
  // end when it is at the top of the box.
  const popup = useMemo(() => {
    const el = area.current;
    if (!canReview || !canComment || composer || !el) return null;
    const lineHeight = 13 * LINE;
    const start = pointAt(el, selection.start);
    const end = pointAt(el, selection.end);
    const width = mode === "edit" ? 68 : 36;
    const left = Math.max(4, Math.min(start.left, el.clientWidth - width - 4));
    const above = start.top - lineHeight - 8;
    const top = above >= 0 ? above : end.top + lineHeight + 8;
    return { left, top, width };
    // scroll moves the selection on screen.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [canReview, canComment, composer, selection, scroll, mode, shownText]);

  // Beside the text, threads follow the order of the passages.
  const ordered = useMemo(
    () =>
      [...open, ...closed].sort(
        (a, b) =>
          Number(!a.open) - Number(!b.open) ||
          (a.found?.start ?? Number.MAX_SAFE_INTEGER) -
            (b.found?.start ?? Number.MAX_SAFE_INTEGER),
      ),
    [open, closed],
  );
  useEffect(() => {
    if (!side || !activeIds[0]) return;
    aside.current
      ?.querySelector(`[data-thread="${CSS.escape(activeIds[0])}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [side, activeIds]);

  const common: CSSProperties = {
    position: "absolute",
    inset: 0,
    margin: 0,
    boxSizing: "border-box",
    padding: PAD,
    border: "1px solid transparent",
    borderRadius: 8,
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: LINE,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    tabSize: 4,
  };

  /** The look of one stretch of the highlight layer. */
  const styleOf = (ids: string[]): CSSProperties => {
    const style: CSSProperties = { color: "transparent", borderRadius: 2 };
    for (const id of ids) {
      const mark = marks.get(id);
      if (!mark) continue;
      if (mark.kind === "del") {
        style.background = DELETE_COLOR;
        style.textDecoration = "line-through";
        style.textDecorationColor = "rgb(220, 38, 38)";
        style.textDecorationThickness = 2;
      } else if (mark.kind === "ins") {
        style.background = INSERT_COLOR;
        style.textDecoration = "underline";
        style.textDecorationColor = "rgb(22, 163, 74)";
      } else
        style.background =
          mark.kind === "suggest" ? SUGGEST_COLOR : COMMENT_COLOR;
      if (mark.ref && activeIds.includes(mark.ref))
        style.boxShadow = ACTIVE_RING;
    }
    return style;
  };

  const composerCard = composer && (
    <div style={box}>
      <strong>
        {composer.kind === "comment" ? "Comment on" : "Suggest an edit to"}
      </strong>
      <Quote>{composer.anchor.quote}</Quote>
      {composer.kind === "suggestion" && (
        <>
          <div style={small}>Change it to (leave empty to delete it)</div>
          <textarea
            style={{ ...input, minHeight: 60, marginBottom: 6 }}
            value={composer.replacement}
            onChange={(e) =>
              setComposer({ ...composer, replacement: e.target.value })
            }
          />
        </>
      )}
      <textarea
        style={{ ...input, minHeight: 50 }}
        placeholder={
          composer.kind === "comment"
            ? "Write a comment"
            : "Add a note (optional)"
        }
        value={composer.body}
        onChange={(e) => setComposer({ ...composer, body: e.target.value })}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button
          type="button"
          style={primary}
          disabled={
            busy || (composer.kind === "comment" && !composer.body.trim())
          }
          onClick={post}
        >
          {composer.kind === "comment" ? "Comment" : "Suggest"}
        </button>
        <button type="button" style={button} onClick={() => setComposer(null)}>
          Cancel
        </button>
      </div>
    </div>
  );

  const card = ({ thread, found }: (typeof placed)[number]) => (
    <ThreadCard
      key={thread.id}
      thread={thread}
      attached={Boolean(found)}
      active={activeIds.includes(thread.id)}
      busy={busy}
      onShow={() => show(thread.id)}
      onAct={act}
    />
  );

  const threadsPanel = side ? (
    <div ref={aside} style={{ display: "grid", gap: 8, alignContent: "start" }}>
      {composerCard}
      {ordered.length === 0 && !composer && (
        <div style={small}>No comments or suggestions yet.</div>
      )}
      {ordered.map(card)}
    </div>
  ) : (
    <>
      {composerCard && <div style={{ marginTop: 10 }}>{composerCard}</div>}
      {activeIds.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {placed.filter((p) => activeIds.includes(p.thread.id)).map(card)}
        </div>
      )}
      {entry && placed.length > 0 && (
        <details
          style={{ marginTop: 10 }}
          open={open.length > 0 && activeIds.length === 0}
        >
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>
            Comments and suggestions ({open.length} open
            {closed.length ? `, ${closed.length} closed` : ""})
          </summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {[...open, ...closed]
              .filter((p) => !activeIds.includes(p.thread.id))
              .map(card)}
          </div>
        </details>
      )}
    </>
  );

  const editor = (
    <div>
      <div style={{ position: "relative", height }}>
        <div
          ref={backdrop}
          aria-hidden="true"
          style={{
            ...common,
            overflow: "hidden",
            color: "transparent",
            pointerEvents: "none",
          }}
        >
          {drawn.map((piece, i) =>
            piece.ids.length ? (
              <mark key={i} style={styleOf(piece.ids)}>
                {piece.text}
              </mark>
            ) : (
              piece.text
            ),
          )}
          {"\n"}
        </div>
        <textarea
          ref={area}
          id={props.id}
          required={props.required}
          value={shownText}
          onChange={(e) => {
            if (mode !== "suggest") {
              props.onChange(e.target.value);
              return;
            }
            // An edit the browser did not announce first: work it out from the texts.
            const { from, to, inserted } = diffEdit(
              shownRef.current,
              e.target.value,
            );
            commit(from, to, inserted, lastInput.current);
          }}
          onScroll={syncScroll}
          onSelect={noteSelection}
          onMouseUp={noteSelection}
          onKeyUp={noteSelection}
          spellCheck
          style={{
            ...common,
            width: "100%",
            height: "100%",
            resize: "none",
            background: "transparent",
            color: "inherit",
            border: "1px solid rgba(128, 128, 128, 0.4)",
            outline: "none",
          }}
        />
        {popup && (
          <div
            role="toolbar"
            aria-label="Comment on the selection"
            // Keep the selection when a button is pressed.
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: "absolute",
              left: popup.left,
              top: popup.top,
              zIndex: 6,
              display: "flex",
              gap: 2,
              padding: 2,
              borderRadius: 8,
              background: "Canvas",
              color: "CanvasText",
              border: "1px solid rgba(128, 128, 128, 0.5)",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
            }}
          >
            <button
              type="button"
              title="Comment"
              aria-label="Comment on the selection"
              style={iconButton}
              onClick={() => begin("comment")}
            >
              💬
            </button>
            {mode === "edit" && (
              <button
                type="button"
                title="Suggest an edit"
                aria-label="Suggest an edit to the selection"
                style={iconButton}
                onClick={() => begin("suggestion")}
              >
                ✏️
              </button>
            )}
          </div>
        )}
      </div>
      {message && (
        <div role="status" style={{ ...small, opacity: 1, marginTop: 6 }}>
          {message}
        </div>
      )}
    </div>
  );

  return (
    <div ref={root}>
      {props.label && (
        <label
          htmlFor={props.id}
          style={{ display: "block", fontWeight: 500, marginBottom: 6 }}
        >
          {props.label}
        </label>
      )}

      {canReview && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "6px 0",
            background: "Canvas",
          }}
        >
          <span style={{ display: "inline-flex" }}>
            <button
              type="button"
              aria-pressed={mode === "edit"}
              style={{
                ...(mode === "edit" ? primary : button),
                borderRadius: "6px 0 0 6px",
              }}
              onClick={() => switchMode("edit")}
            >
              Editing
            </button>
            <button
              type="button"
              aria-pressed={mode === "suggest"}
              style={{
                ...(mode === "suggest" ? primary : button),
                borderRadius: "0 6px 6px 0",
              }}
              onClick={() => switchMode("suggest")}
            >
              Suggesting
            </button>
          </span>
          {!fullscreen && (
            <button
              type="button"
              style={button}
              onClick={() => setBeside(!beside)}
            >
              {beside ? "Comments below" : "Comments beside"}
            </button>
          )}
          <span style={small}>
            {mode === "suggest"
              ? "Suggesting: your typing is kept as suggestions."
              : "Select text to comment or suggest an edit."}
            {open.length ? ` · ${open.length} open` : ""}
          </span>
        </div>
      )}

      {side ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 340px",
            gap: 16,
          }}
        >
          {editor}
          <div
            style={{
              maxHeight: fullscreen ? "calc(100vh - 150px)" : height,
              overflowY: "auto",
            }}
          >
            {threadsPanel}
          </div>
        </div>
      ) : (
        <>
          {editor}
          {threadsPanel}
        </>
      )}
    </div>
  );
}

/** What EmDash reads from this module: widgets by name. */
export const fields = { "review-text": ReviewTextField };
