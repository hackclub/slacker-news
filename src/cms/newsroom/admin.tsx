/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * The article text editor with comments and suggestions on selected passages.
 *
 * EmDash draws a field with this component when the field's widget is
 * "newsroom:review-text" (set on the body of each post in the seed). It is a
 * plain text box with a highlight layer behind it:
 *
 *  - select text, then choose Comment or Suggest an edit;
 *  - passages with an open thread are highlighted, yellow for comments and
 *    blue for suggestions; click one to open its thread;
 *  - an editor accepts a suggestion to put its text into the box, then saves
 *    the article as usual (which sends it back to review).
 *
 * Threads are stored by the newsroom plugin and shared with its Review panel.
 * They find their passage again by its quoted text, so edits above them do not
 * lose them (see anchors.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type Thread = ReviewComment & { id: string };
type Answer = {
  threads?: Thread[];
  you?: { id: string; role: number };
  error?: string;
};
type Entry = { collection: string; id: string };

const ROUTE = "/_emdash/api/plugins/newsroom/threads";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const LINE = 1.55;
const PAD = 12;
const COMMENT_COLOR = "rgba(250, 204, 21, 0.4)";
const SUGGEST_COLOR = "rgba(59, 130, 246, 0.3)";
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
  return (
    <div
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
      <Quote>
        {thread.quote}
        {!attached && open ? " (text has changed)" : ""}
      </Quote>
      {suggestion && (
        <div style={{ whiteSpace: "pre-wrap" }}>
          {thread.replacement ? (
            <>
              Change to:{" "}
              <ins
                style={{ background: SUGGEST_COLOR, textDecoration: "none" }}
              >
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
              if (e.key === "Enter" && reply.trim()) {
                onAct({ op: "reply", id: thread.id, body: reply });
                setReply("");
              }
            }}
          />
          <button
            type="button"
            style={button}
            disabled={busy || !reply.trim()}
            onClick={() => {
              onAct({ op: "reply", id: thread.id, body: reply });
              setReply("");
            }}
          >
            Reply
          </button>
        </div>
      )}
    </div>
  );
}

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
  const height = Math.round(rows * 13 * LINE + PAD * 2);
  const entry = useMemo(entryFromLocation, []);

  const area = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [you, setYou] = useState<{ id: string; role: number }>();
  const [selection, setSelection] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [composer, setComposer] = useState<{
    kind: "comment" | "suggestion";
    anchor: Anchor;
    body: string;
    replacement: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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

  // Where each open thread sits in the text as it is now.
  const placed = useMemo(
    () =>
      threads.map((thread) => {
        const open =
          thread.kind === "suggestion"
            ? thread.status === "open"
            : !thread.resolved;
        const found = findAnchor(text, {
          quote: thread.quote,
          prefix: thread.prefix ?? "",
          suffix: thread.suffix ?? "",
          start: thread.start ?? 0,
        });
        return { thread, open, found };
      }),
    [threads, text],
  );
  const ranges = useMemo(
    () =>
      placed.flatMap(({ thread, open, found }) =>
        open && found
          ? [{ id: thread.id, start: found.start, end: found.end }]
          : [],
      ),
    [placed],
  );
  const kindOf = useMemo(
    () => new Map(threads.map((t) => [t.id, t.kind ?? "comment"])),
    [threads],
  );
  const drawn = useMemo(() => pieces(text, ranges), [text, ranges]);

  const syncScroll = () => {
    if (area.current && backdrop.current) {
      backdrop.current.scrollTop = area.current.scrollTop;
      backdrop.current.scrollLeft = area.current.scrollLeft;
    }
  };

  const noteSelection = () => {
    const el = area.current;
    if (!el) return;
    const start = Math.min(el.selectionStart, el.selectionEnd);
    const end = Math.max(el.selectionStart, el.selectionEnd);
    setSelection({ start, end });
    // A click inside a highlight opens its thread.
    if (start === end) setActiveIds(marksAt(ranges, start));
    else setActiveIds([]);
  };

  const show = (id: string) => {
    const found = placed.find((p) => p.thread.id === id)?.found;
    const el = area.current;
    if (!found || !el) return;
    setActiveIds([id]);
    el.focus();
    el.setSelectionRange(found.start, found.end);
    const line = text.slice(0, found.start).split("\n").length;
    el.scrollTop = Math.max(0, (line - 3) * 13 * LINE);
    syncScroll();
  };

  const begin = (kind: "comment" | "suggestion") => {
    if (selection.start === selection.end) return;
    const anchor = anchorFor(text, selection.start, selection.end);
    setComposer({ kind, anchor, body: "", replacement: anchor.quote });
  };

  const send = async (body: Record<string, unknown>) => {
    if (!entry) return false;
    setBusy(true);
    const answer = await call(entry, body);
    setBusy(false);
    apply(answer);
    return !answer.error;
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
  const open = placed.filter((p) => p.open);
  const closed = placed.filter((p) => !p.open);
  const shown = activeIds.length
    ? placed.filter((p) => activeIds.includes(p.thread.id))
    : [];
  const canReview = Boolean(entry) && (you?.role ?? 30) >= 30;

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

  return (
    <div>
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
          <button
            type="button"
            style={hasSelection ? primary : button}
            disabled={!hasSelection}
            onClick={() => begin("comment")}
          >
            Comment
          </button>
          <button
            type="button"
            style={hasSelection ? primary : button}
            disabled={!hasSelection}
            onClick={() => begin("suggestion")}
          >
            Suggest an edit
          </button>
          <span style={small}>
            {hasSelection
              ? `${selection.end - selection.start} characters selected`
              : "Select text to comment or suggest an edit."}
            {open.length ? ` · ${open.length} open` : ""}
          </span>
        </div>
      )}

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
          {drawn.map((piece, i) => {
            if (!piece.ids.length) return piece.text;
            const last = piece.ids[piece.ids.length - 1];
            const suggest = kindOf.get(last) === "suggestion";
            return (
              <mark
                key={i}
                style={{
                  color: "transparent",
                  background: suggest ? SUGGEST_COLOR : COMMENT_COLOR,
                  boxShadow: piece.ids.some((id) => activeIds.includes(id))
                    ? ACTIVE_RING
                    : "none",
                  borderRadius: 2,
                }}
              >
                {piece.text}
              </mark>
            );
          })}
          {"\n"}
        </div>
        <textarea
          ref={area}
          id={props.id}
          required={props.required}
          value={text}
          onChange={(e) => props.onChange(e.target.value)}
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
      </div>

      {message && (
        <div role="status" style={{ ...small, opacity: 1, marginTop: 6 }}>
          {message}
        </div>
      )}

      {composer && (
        <div style={{ ...box, marginTop: 10 }}>
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
            <button
              type="button"
              style={button}
              onClick={() => setComposer(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {shown.map(({ thread, found }) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              attached={Boolean(found)}
              active
              busy={busy}
              onShow={() => show(thread.id)}
              onAct={act}
            />
          ))}
        </div>
      )}

      {entry && placed.length > 0 && (
        <details
          style={{ marginTop: 10 }}
          open={open.length > 0 && shown.length === 0}
        >
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>
            Comments and suggestions ({open.length} open
            {closed.length ? `, ${closed.length} closed` : ""})
          </summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {[...open, ...closed]
              .filter(({ thread }) => !activeIds.includes(thread.id))
              .map(({ thread, found }) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  attached={Boolean(found)}
                  active={false}
                  busy={busy}
                  onShow={() => show(thread.id)}
                  onAct={act}
                />
              ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** What EmDash reads from this module: widgets by name. */
export const fields = { "review-text": ReviewTextField };
