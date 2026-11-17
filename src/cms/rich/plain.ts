/**
 * The plain text of a rich-text article: one line for each paragraph, heading,
 * list item or code block, and nothing for blocks that are not text. It is the
 * same text the editor's comments are anchored in (see
 * src/cms/newsroom/doc-text.ts), so the review panel can say which line a
 * comment is about.
 */
export function portableTextToPlain(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const lines: string[] = [];
  for (const block of blocks as Record<string, unknown>[]) {
    if (block?._type === "block" && Array.isArray(block.children)) {
      lines.push(
        (block.children as { text?: unknown }[])
          .map((child) => (typeof child.text === "string" ? child.text : ""))
          .join(""),
      );
    } else if (block?._type === "code") {
      lines.push(typeof block.code === "string" ? block.code : "");
    }
  }
  return lines.join("\n");
}
