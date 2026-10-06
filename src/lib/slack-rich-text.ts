export type Token =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; name: string }
  | { type: "channel"; id: string; name?: string }
  | { type: "channel-candidate"; value: string }
  | { type: "link"; url: string; label: string }
  | { type: "emoji"; name: string }
  | { type: "code"; value: string }
  | { type: "bold" | "italic" | "strike"; children: Token[] };

// Slack escapes these three characters in mrkdwn.
export function decodeSlackEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export type SlackBlock =
  | { type: "paragraph"; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "code"; text: string }
  | { type: "list"; ordered: boolean; start: number; items: SlackListItem[] };

export type SlackListItem = { text: string; children: SlackBlock[] };

// Numbered items take one or two digits, so a line opening with a year
// ("2026. What a year") stays a paragraph.
const listLine = /^( *)(•|◦|▪︎?|-|\d{1,2}\.) (.*)$/;

// Splits a list's lines into items, nesting deeper-indented lines (four
// spaces a level, as Indigest writes them) under the item above.
function parseList(lines: string[]): SlackBlock {
  const [, baseIndent, marker] = lines[0]!.match(listLine)!;
  const items: SlackListItem[] = [];
  let nested: string[] = [];
  const flushNested = () => {
    if (nested.length && items.length) {
      items[items.length - 1]!.children.push(parseList(nested));
    }
    nested = [];
  };
  for (const line of lines) {
    const [, indent, , text] = line.match(listLine)!;
    if (indent!.length > baseIndent!.length) {
      nested.push(line);
      continue;
    }
    flushNested();
    items.push({ text: text!, children: [] });
  }
  flushNested();
  const ordered = /^\d/.test(marker!);
  return {
    type: "list",
    ordered,
    start: ordered ? Number.parseInt(marker!, 10) : 1,
    items,
  };
}

// A line that is one italic span from end to end. Links inside count as one
// unit, so underscores in their URLs do not end the span.
const wholeItalicLine = /^_((?:<[^>\n]*>|[^_\n])+?)_$/;

// Italic lines that open a message are an editor's note or disclosure, like
// the italic intros of markdown posts, so they read as a quote.
function quoteLeadingItalics(blocks: SlackBlock[]): SlackBlock[] {
  const lines: string[] = [];
  let index = 0;
  for (; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    const match =
      block.type === "paragraph" && block.text.trim().match(wholeItalicLine);
    if (!match) break;
    lines.push(match[1]!);
  }
  return lines.length
    ? [{ type: "quote", lines }, ...blocks.slice(index)]
    : blocks;
}

// Reads Slack mrkdwn into blocks. Every line outside a list, quote or code
// block is its own paragraph, as each line shows on its own in Slack.
export function parseSlackBlocks(input: string): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const segments = input.split(/```([\s\S]*?)```/);

  segments.forEach((segment, index) => {
    if (index % 2 === 1) {
      blocks.push({ type: "code", text: segment.replace(/^\n|\n$/g, "") });
      return;
    }

    const lines = segment.split("\n");
    for (let i = 0; i < lines.length;) {
      const line = lines[i]!;
      if (/^(>|&gt;) ?/.test(line)) {
        const quoted: string[] = [];
        while (i < lines.length && /^(>|&gt;) ?/.test(lines[i]!)) {
          quoted.push(lines[i]!.replace(/^(>|&gt;) ?/, ""));
          i += 1;
        }
        blocks.push({ type: "quote", lines: quoted });
      } else if (listLine.test(line)) {
        // A list ends where a line at its own indent switches between
        // bullets and numbers.
        const [, indent, marker] = line.match(listLine)!;
        const ordered = /^\d/.test(marker!);
        const listed: string[] = [];
        while (i < lines.length && listLine.test(lines[i]!)) {
          const [, nextIndent, nextMarker] = lines[i]!.match(listLine)!;
          if (
            nextIndent!.length <= indent!.length &&
            /^\d/.test(nextMarker!) !== ordered
          ) {
            break;
          }
          listed.push(lines[i]!);
          i += 1;
        }
        blocks.push(parseList(listed));
      } else {
        if (line.trim()) blocks.push({ type: "paragraph", text: line });
        i += 1;
      }
    }
  });

  return quoteLeadingItalics(blocks);
}

export function truncateSlackWords(input: string, count: number): string {
  const words = input.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const wordWeight = (word: string) => word.split(/-+/).filter(Boolean).length;
  const totalWeight = words.reduce((sum, word) => sum + wordWeight(word), 0);
  if (totalWeight <= count) return input;

  const included: string[] = [];
  let usedWeight = 0;
  for (const word of words) {
    const weight = wordWeight(word);
    if (included.length > 0 && usedWeight + weight > count) break;
    included.push(word);
    usedWeight += weight;
    if (usedWeight >= count) break;
  }

  const truncated = `${included.join(" ")}...`;
  let boldOpen = false;
  let italicOpen = false;

  for (let index = 0; index < truncated.length; index += 1) {
    const character = truncated[index];
    const previous = truncated[index - 1] ?? "";
    const next = truncated[index + 1] ?? "";

    if (character === "*" && truncated[index - 1] !== "\\") {
      boldOpen = !boldOpen;
    } else if (
      character === "_" &&
      (!/\w/.test(previous) || !/\w/.test(next))
    ) {
      italicOpen = !italicOpen;
    }
  }

  return `${truncated}${italicOpen ? "_" : ""}${boldOpen ? "*" : ""}`;
}
