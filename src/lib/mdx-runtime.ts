/**
 * Compiles MDX that is stored in the CMS, at request time.
 *
 * Posts written as files are compiled by @astrojs/mdx during the build. Posts
 * stored in EmDash only exist in the database, so they go through the same
 * remark/rehype plugins here instead. Keep the plugin list in step with the
 * `markdown` options in astro.config.mjs.
 *
 * MDX is code: whoever can edit a post in the CMS can run JavaScript on the
 * server. Only give CMS accounts to people who could already commit to the
 * repository.
 */
import { createHash } from "node:crypto";
import { evaluate, nodeTypes } from "@mdx-js/mdx";
import {
  rehypeHeadingIds,
  rehypeShiki,
  markdownConfigDefaults,
} from "@astrojs/markdown-remark";
// Named imports, read inside functions only: a namespace import is built
// eagerly and trips over the import cycle inside Astro's runtime.
import { Fragment, jsx, jsxs } from "astro/jsx-runtime";
// @ts-expect-error Exported at runtime, and what @astrojs/mdx itself imports, but missing from Astro's types.
import { __astro_tag_component__ } from "astro/runtime/server/index.js";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkSmartypants from "remark-smartypants";
import Caption from "../components/Caption.astro";
import Emoji from "../components/Emoji.astro";
import M from "../components/M.astro";
import RawHtml from "../components/RawHtml.astro";
import SlackChannel from "../components/SlackChannel.astro";
import SlackMention from "../components/SlackMention.astro";
import YouTube from "../components/YouTube.astro";

/** Components a CMS post can use without importing them. */
export const mdxComponents = {
  Caption,
  Emoji,
  M,
  RawHtml,
  SlackChannel,
  SlackMention,
  YouTube,
};

type MdxContent = (props?: Record<string, unknown>) => unknown;

const MAX_CACHED = 500;
const compiled = new Map<string, Promise<MdxContent>>();

/**
 * Component imports are meaningless once a post has left the repository, and
 * `evaluate` cannot resolve them. The migration strips them; this covers posts
 * pasted into the CMS with their imports still attached.
 */
export function stripComponentImports(source: string): string {
  return source.replace(
    /^import\s+\w+\s+from\s+["'][^"']*\/components\/\w+\.astro["'];?[ \t]*\r?\n/gm,
    "",
  );
}

async function compile(source: string): Promise<MdxContent> {
  const { default: MDXContent } = await evaluate(
    stripComponentImports(source),
    {
      Fragment,
      jsx,
      jsxs,
      format: "mdx",
      elementAttributeNameCase: "html",
      remarkPlugins: [
        remarkGfm,
        remarkSmartypants,
        [remarkMath, { singleDollarTextMath: false }],
      ],
      rehypePlugins: [
        [rehypeRaw, { passThrough: nodeTypes }],
        [rehypeShiki, markdownConfigDefaults.shikiConfig],
        rehypeKatex,
        rehypeHeadingIds,
      ],
    },
  );

  const Content: MdxContent = (props = {}) =>
    MDXContent({
      ...props,
      // Astro's Fragment is a symbol, which MDX's component type has no room for.
      components: {
        Fragment,
        ...mdxComponents,
        ...(props.components as Record<string, unknown> | undefined),
      } as Record<string, any>,
    });
  // The markers @astrojs/mdx puts on a compiled file, so Astro renders this
  // with its JSX renderer like any other MDX component.
  Object.assign(Content, {
    [Symbol.for("mdx-component")]: true,
    [Symbol.for("astro.needsHeadRendering")]: true,
  });
  __astro_tag_component__(Content, "astro:jsx");
  return Content;
}

export function renderMdx(source: string): Promise<{ Content: MdxContent }> {
  const key = createHash("sha1").update(source).digest("hex");
  let pending = compiled.get(key);
  if (!pending) {
    pending = compile(source);
    if (compiled.size >= MAX_CACHED)
      compiled.delete(compiled.keys().next().value!);
    compiled.set(key, pending);
    // A post that fails to compile should be retried after it is fixed.
    pending.catch(() => compiled.delete(key));
  }
  return pending.then((Content) => ({ Content }));
}
