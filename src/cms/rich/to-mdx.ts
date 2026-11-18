/**
 * Turns what the rich-text editor stores (Portable Text) into MDX, so an
 * article written there is drawn by the same code as an MDX file: same
 * markdown rules, same components.
 *
 * Only what the editor can make is handled. A block of an unknown kind is left
 * out rather than guessed at.
 */
import { COMPONENT_BLOCKS } from "./blocks.mjs";
import { slackTarget } from "./slack-links";

type Span = {
  _type: "span";
  text: string;
  marks?: string[];
};

type MarkDef = { _key: string; _type: string; href?: string };

export type PortableBlock = {
  _type: string;
  _key?: string;
  style?: string;
  listItem?: "bullet" | "number";
  level?: number;
  children?: Span[];
  markDefs?: MarkDef[];
  [field: string]: unknown;
};

const BY_TYPE = new Map(COMPONENT_BLOCKS.map((block) => [block.type, block]));

/** Characters that would be read as markdown or as MDX code. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_{}[\]<>#|~$])/g, "\\$1");
}

/** Wraps text in a marker without letting the marker touch a space. */
function wrap(text: string, open: string, close = open): string {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const trail = /\s*$/.exec(text)?.[0] ?? "";
  const core = text.trim();
  return core ? `${lead}${open}${core}${close}${trail}` : text;
}

/** A JSX attribute holding any string, whatever characters it has. */
function attribute(name: string, value: unknown): string {
  return `${name}={${JSON.stringify(String(value))}}`;
}

function spanToMdx(span: Span, defs: Map<string, MarkDef>): string {
  const marks = span.marks ?? [];
  // A link to a Slack person or channel is a mention: the site's component
  // takes the place of the linked text, inside the sentence.
  for (const mark of marks) {
    const href = defs.get(mark)?.href;
    const target = typeof href === "string" ? slackTarget(href) : undefined;
    if (!target) continue;
    const name = span.text.trim().replace(/^[@#]/, "");
    const lead = /^\s*/.exec(span.text)?.[0] ?? "";
    const trail = /\s*$/.exec(span.text)?.[0] ?? "";
    const tag =
      target.kind === "user"
        ? `<SlackMention ${attribute("id", target.id)} ${attribute("name", name)} />`
        : `<SlackChannel ${attribute("id", target.id)} ${attribute("label", name)} />`;
    return `${lead}${tag}${trail}`;
  }
  const code = marks.includes("code");
  // Code is verbatim: nothing inside it is escaped.
  let out = code ? span.text : escapeText(span.text);
  if (code) out = wrap(out, "`");
  for (const mark of marks) {
    if (mark === "strong") out = wrap(out, "**");
    else if (mark === "em") out = wrap(out, "_");
    else if (mark === "strike-through") out = wrap(out, "~~");
    else if (mark === "underline") out = wrap(out, "<u>", "</u>");
    else {
      const def = defs.get(mark);
      if (def?._type === "link" && typeof def.href === "string") {
        const href = def.href.replace(/[()\s]/g, encodeURIComponent);
        out = wrap(out, "[", `](${href})`);
      }
    }
  }
  return out;
}

function inline(block: PortableBlock): string {
  const defs = new Map((block.markDefs ?? []).map((def) => [def._key, def]));
  return (block.children ?? [])
    .map((child) => (child._type === "span" ? spanToMdx(child, defs) : ""))
    .join("")
    .replace(/\n/g, "  \n");
}

function componentToMdx(block: PortableBlock): string | undefined {
  const spec = BY_TYPE.get(block._type);
  if (!spec) return undefined;
  const given = (name: string) => {
    const value = block[name];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const attributes = spec.fields
    .filter((field) => field.action_id !== spec.children)
    .flatMap((field) => {
      const value = given(field.action_id);
      return value === undefined ? [] : [attribute(field.action_id, value)];
    });
  const open = [spec.tag, ...attributes].join(" ");
  if (spec.children) {
    const content = given(spec.children);
    return content === undefined
      ? undefined
      : `<${open}>${escapeText(content)}</${spec.tag}>`;
  }
  return `<${open} />`;
}

const HEADINGS: Record<string, string> = {
  h1: "#",
  h2: "##",
  h3: "###",
  h4: "####",
  h5: "#####",
  h6: "######",
};

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`.trimEnd())
    .join("\n");
}

/** The MDX for a list of Portable Text blocks. */
export function portableTextToMdx(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const out: string[] = [];
  // How many items of each numbered list are behind us, by nesting level.
  let counters: number[] = [];
  let previousWasList = false;

  for (const raw of blocks as PortableBlock[]) {
    if (!raw || typeof raw !== "object") continue;
    const isList = raw._type === "block" && Boolean(raw.listItem);
    if (!isList) counters = [];

    let piece: string | undefined;
    if (raw._type === "block") {
      const text = inline(raw);
      if (raw.listItem) {
        const level = Math.max(1, raw.level ?? 1);
        counters.length = level;
        let marker = "-";
        if (raw.listItem === "number") {
          counters[level - 1] = (counters[level - 1] ?? 0) + 1;
          marker = `${counters[level - 1]}.`;
        } else {
          counters[level - 1] = 0;
        }
        piece = `${"  ".repeat(level - 1)}${marker} ${text}`;
      } else if (HEADINGS[raw.style ?? ""]) {
        piece = `${HEADINGS[raw.style as string]} ${text}`;
      } else if (raw.style === "blockquote") {
        piece = prefixLines(text, "> ");
      } else if (text.trim()) {
        piece = text;
      }
    } else if (raw._type === "break") {
      piece = "---";
    } else if (raw._type === "code") {
      const code = typeof raw.code === "string" ? raw.code : "";
      const language = typeof raw.language === "string" ? raw.language : "";
      const fence = code.includes("```") ? "````" : "```";
      piece = `${fence}${language}\n${code}\n${fence}`;
    } else if (raw._type === "image") {
      const url = (raw.asset as { url?: string } | undefined)?.url;
      if (url) {
        const alt = typeof raw.alt === "string" ? raw.alt : "";
        piece = `![${escapeText(alt)}](${url.replace(/[()\s]/g, encodeURIComponent)})`;
      }
    } else {
      piece = componentToMdx(raw);
    }

    if (piece === undefined) continue;
    // Items of one list sit on consecutive lines; everything else is
    // separated by a blank line.
    out.push(isList && previousWasList ? `\n${piece}` : `\n\n${piece}`);
    previousWasList = isList;
  }
  return `${out.join("").trim()}\n`.replace(/^\n$/, "");
}
