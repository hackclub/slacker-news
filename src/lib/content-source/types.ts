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
  /** One per author, in order; empty where a person has no Slack ID. From the CMS bylines. */
  authorSlackIds?: string[];
  excerpt?: string;
  responseTo?: string | string[];
  followUpTo?: string | string[];
  /** Only readers who are signed in may see this post. Set in the CMS. */
  membersOnly?: boolean;
};

export type ChangelogData = {
  title: string;
  date: Date;
  author: string | string[];
  authorSlackIds?: string[];
  excerpt?: string;
  responseTo?: string | string[];
  followUpTo?: string | string[];
};

export type PageData = {
  title?: string;
};

/** Someone the site credits. In the CMS they are bylines. */
export type Person = {
  name: string;
  slackId?: string;
  roles?: string[];
};
