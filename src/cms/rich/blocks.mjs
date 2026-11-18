/**
 * The components an article can use, as blocks of EmDash's rich-text editor.
 *
 * Each one is offered in the editor's slash menu (type "/"), edited in a small
 * form, and stored in the article as a Portable Text block of the given
 * `type`. `to-mdx.ts` turns the stored block back into the MDX tag, so the
 * rich editor and the MDX files share one set of components.
 *
 * This file is plain JavaScript because astro.config.mjs reads it too.
 */

const text = (action_id, label, extra = {}) => ({
  type: "text_input",
  action_id,
  label,
  ...extra,
});

/**
 * `tag` is the MDX component. `children` names the field that becomes the
 * tag's content instead of an attribute. A `hidden` block is not offered in
 * the slash menu.
 *
 * @type {{
 *   type: string;
 *   tag: string;
 *   children?: string;
 *   hidden?: boolean;
 *   label: string;
 *   description: string;
 *   icon?: string;
 *   category: string;
 *   fields: ReturnType<typeof text>[];
 * }[]}
 */
export const COMPONENT_BLOCKS = [
  {
    type: "snYouTube",
    tag: "YouTube",
    label: "YouTube video",
    description: "A video that loads only when played",
    icon: "video",
    category: "Embeds",
    fields: [
      text("id", "Video ID", { placeholder: "The v= part of a watch URL" }),
      text("title", "Title"),
      text("caption", "Caption (optional)"),
    ],
  },
  {
    type: "snCaption",
    tag: "Caption",
    children: "text",
    label: "Caption",
    description: "A small line of text, as under a picture",
    category: "Text",
    fields: [text("text", "Text", { multiline: true })],
  },
  {
    type: "snMath",
    tag: "M",
    label: "Math",
    description: "A formula in LaTeX",
    category: "Text",
    fields: [text("d", "LaTeX", { multiline: true })],
  },
  {
    type: "snSlackMention",
    tag: "SlackMention",
    // Mentions are typed into the sentence with @ now; this stays so articles
    // that already hold the block are still drawn.
    hidden: true,
    label: "Slack user",
    description: "A mention of someone on Slack",
    category: "Slack",
    fields: [
      text("id", "Slack user", {
        placeholder: "Search by name, or paste an ID",
      }),
      text("name", "Name"),
    ],
  },
  {
    type: "snSlackChannel",
    tag: "SlackChannel",
    hidden: true,
    label: "Slack channel",
    description: "A link to a Slack channel",
    category: "Slack",
    fields: [
      text("id", "Slack channel", {
        placeholder: "Search by name, or paste an ID",
      }),
      text("label", "Label (optional)"),
    ],
  },
  {
    type: "snEmoji",
    tag: "Emoji",
    label: "Emoji",
    description: "A Hack Club Slack emoji",
    category: "Slack",
    fields: [text("name", "Name"), text("src", "Image URL (optional)")],
  },
  {
    type: "snRawHtml",
    tag: "RawHtml",
    label: "Raw HTML",
    description: "HTML put into the page as written",
    icon: "code",
    category: "Embeds",
    fields: [text("content", "HTML", { multiline: true })],
  },
];

/** The shape EmDash's `portableTextBlocks` setting takes. */
export const portableTextBlocks = COMPONENT_BLOCKS.filter(
  (block) => !block.hidden,
).map(({ type, label, description, icon, category, fields }) => ({
  type,
  label,
  description,
  ...(icon ? { icon } : {}),
  category,
  fields,
}));
