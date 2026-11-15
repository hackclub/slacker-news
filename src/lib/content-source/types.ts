/**
 * One piece of content, wherever it is stored. `src/lib/content.ts` turns
 * these into the Post / changelog shapes the pages use.
 */
export type SourceEntry<Data> = {
  /** `<category>/<slug>` for posts, `<slug>` for changelogs and pages. */
  id: string;
  data: Data;
  /** MDX source, without frontmatter. */
  body: string;
  render(): Promise<{ Content: any }>;
};

export type PostData = {
  id?: string;
  title: string;
  date: Date;
  author?: string | string[];
  excerpt?: string;
  frontPagePreview?: string;
  responseTo?: string | string[];
  followUpTo?: string | string[];
};

export type ChangelogData = {
  title: string;
  date: Date;
  author: string | string[];
  excerpt?: string;
  responseTo?: string | string[];
  followUpTo?: string | string[];
};

export type PageData = {
  title?: string;
};
