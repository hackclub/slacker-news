// The lead story's excerpt on the homepage, rendered as real HTML from the
// article's opening blocks: the same paragraphs, lists, bold and quotes the
// article shows, so the excerpt reads like the article's opening and barely
// changes shape when it carries over to the article page. The homepage
// script trims it to fit beside the opinion rail.
import {
  createMarkdownProcessor,
  type MarkdownRenderer,
} from "@astrojs/markdown-remark";

let processor: Promise<MarkdownRenderer> | undefined;

function getProcessor(): Promise<MarkdownRenderer> {
  processor ??= createMarkdownProcessor();
  return processor;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"))?.[1];
}

// The inline components articles use, as the plain markup they render to.
// Mentions and channels become spans rather than links: the whole lead story
// is one link, and the article page is where they're clickable.
function inlineComponents(markdown: string): string {
  return markdown
    .replace(/<SlackMention\b[^>]*\/?>/g, (tag) => {
      const name = attribute(tag, "name") ?? "Slack user";
      return `<span class="slack_user">@${escapeHtml(name.replace(/^@+/, ""))}</span>`;
    })
    .replace(/<SlackChannel\b[^>]*\/?>/g, (tag) => {
      const id = attribute(tag, "id") ?? "";
      const label = attribute(tag, "label");
      const lookup =
        !label && /^C[A-Z0-9]+$/i.test(id)
          ? ` data-slack-channel-id="${escapeHtml(id)}"`
          : "";
      return `<span class="slack_channel"${lookup}>#${escapeHtml(label ?? id)}</span>`;
    })
    .replace(/<Emoji\b[^>]*\/?>/g, (tag) => {
      const name = attribute(tag, "name") ?? "";
      const src =
        attribute(tag, "src") ??
        `https://cachet.hackclub.com/emojis/${encodeURIComponent(name)}/r`;
      return `<img class="emoji" src="${escapeHtml(src)}" alt=":${escapeHtml(name)}:">`;
    });
}

function isImageBlock(block: string): boolean {
  return (
    /^(!\[[^\]]*\]\([^)]*\)|<img\b|<Image\b)/i.test(block) &&
    !/\n\s*\n/.test(block)
  );
}

function isTableBlock(block: string): boolean {
  return block
    .split("\n")
    .some(
      (line) =>
        /^\s*\|?[\s\-:|]+\|[\s\-:|]+\|?\s*$/.test(line) && /-/.test(line),
    );
}

// The run of blocks the excerpt draws from: paragraphs and lists from the top
// of the article. A leading image, pull quotes and blockquotes are skipped;
// the run ends at the first heading, rule, table or embed after it starts.
export function openingBlocks(body: string, limit: number): string[] {
  const blocks = body
    .replace(/^import\s.+$/gm, "")
    .replace(/^export\s.+$/gm, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const chosen: string[] = [];
  for (const [index, block] of blocks.entries()) {
    if (index === 0 && isImageBlock(block)) continue;
    if (/^>/.test(block) || /^["“]/.test(block)) continue;
    const ends =
      /^#{1,6}\s/.test(block) ||
      /^([-*_=])(\s*\1){2,}\s*$/.test(block) ||
      isTableBlock(block) ||
      isImageBlock(block) ||
      /^<(?!SlackMention\b|SlackChannel\b|Emoji\b)[A-Za-z]/.test(block);
    if (ends) {
      if (chosen.length > 0) break;
      continue;
    }
    chosen.push(inlineComponents(block));
    if (chosen.length >= limit) break;
  }
  return chosen;
}

export async function renderOpeningHtml(
  body: string,
  limit: number,
): Promise<string> {
  const blocks = openingBlocks(body, limit);
  if (blocks.length === 0) return "";
  const { code } = await (await getProcessor()).render(blocks.join("\n\n"));
  return code
    .replace(/<a\b[^>]*>/g, '<span class="excerpt-link">')
    .replace(/<\/a>/g, "</span>");
}

// Slack-published articles already arrive as plain paragraphs.
export function paragraphsHtml(paragraphs: string[], limit: number): string {
  return paragraphs
    .slice(0, limit)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");
}
