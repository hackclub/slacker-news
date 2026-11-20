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

/**
 * Inline components typed as text: `:name:` is a Slack emoji and `$$x^2$$` a
 * formula, as in Slack and in the MDX files. The colons must stand apart from
 * other words and colons, so a time like 10:30:00 stays text.
 */
const INLINE_COMPONENT =
  /\$\$([^$\n]+?)\$\$|(?<![\w:]):([a-z0-9][a-z0-9_+'-]*):(?![\w:])/g;

/** Text, escaped, with its emoji and formulas turned into components. */
function textToMdx(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(INLINE_COMPONENT)) {
    out += escapeText(text.slice(last, match.index));
    out +=
      match[1] !== undefined
        ? `<M ${attribute("d", match[1].trim())} />`
        : `<Emoji ${attribute("name", match[2])} />`;
    last = match.index + match[0].length;
  }
  return out + escapeText(text.slice(last));
}

/**
 * A link's address, if it is one a reader can safely follow: a web or mail
 * address, or a path on this site. Anything else (`javascript:` above all) is
 * dropped. Characters that mean something to markdown or MDX are encoded.
 */
export function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (!/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(trimmed)) return undefined;
  return trimmed.replace(/[()\s{}<>"`\\]/g, (c) => encodeURIComponent(c));
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
  let out = code ? span.text : textToMdx(span.text);
  if (code) out = wrap(out, "`");
  for (const mark of marks) {
    if (mark === "strong") out = wrap(out, "**");
    else if (mark === "em") out = wrap(out, "_");
    else if (mark === "strike-through") out = wrap(out, "~~");
    else if (mark === "underline") out = wrap(out, "<u>", "</u>");
    else {
      const def = defs.get(mark);
      const href =
        def?._type === "link" && typeof def.href === "string"
          ? safeHref(def.href)
          : undefined;
      if (href) out = wrap(out, "[", `](${href})`);
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
        // MDX reads a paragraph that begins with `import` or `export` as
        // code to run. Written as an entity, the first letter is only text.
        piece = text.replace(
          /^(\s*)([ie])(?=mport\b|xport\b)/,
          (_all, space: string, letter: string) =>
            `${space}&#${letter.charCodeAt(0)};`,
        );
      }
    } else if (raw._type === "break") {
      piece = "---";
    } else if (raw._type === "code") {
      const code = typeof raw.code === "string" ? raw.code : "";
      const language =
        typeof raw.language === "string"
          ? raw.language.replace(/[^\w+#.-]/g, "").slice(0, 30)
          : "";
      // A fence longer than any run of backticks in the code, so the code
      // cannot close it.
      const longest = Math.max(
        2,
        ...(code.match(/`+/g) ?? []).map((run) => run.length),
      );
      const fence = "`".repeat(longest + 1);
      piece = `${fence}${language}\n${code}\n${fence}`;
    } else if (raw._type === "image") {
      const url = (raw.asset as { url?: string } | undefined)?.url;
      const src = typeof url === "string" ? safeHref(url) : undefined;
      if (src) {
        const alt = typeof raw.alt === "string" ? raw.alt : "";
        piece = `![${escapeText(alt)}](${src})`;
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
