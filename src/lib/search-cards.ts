// Search result cards as HTML strings, shared by the search page's server
// render (the full list, before any query) and its in-browser search.
import type { SearchDocument } from "./search";
import {
  bylineTransitionName,
  excerptTransitionName,
  readingTimeTransitionName,
  titleTransitionName,
} from "./transitions";

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] as string,
  );

export const truncateWords = (text: string, count: number) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= count
    ? words.join(" ")
    : `${words.slice(0, count).join(" ")}…`;
};

// "by" and each author: Slack users as a mention chip with their
// profile picture, everyone else as plain text.
const bylineHtml = (doc: SearchDocument) => {
  const authors = doc.authors ?? [];
  if (authors.length === 0) return "";
  const names = authors.map((author) =>
    author.slackId
      ? `${author.avatar ? `<span class="byline-avatar"><img src="${escapeHtml(author.avatar)}" alt="" width="20" height="20" decoding="async" onerror="this.parentElement.remove()"></span>` : ""}<span class="slack_user">@${escapeHtml(author.name)}</span>`
      : escapeHtml(author.name),
  );
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} &amp; ${names[names.length - 1]}`;
  return `<span class="search-author" data-vt-byline="${bylineTransitionName(doc.url)}">by ${list}</span>`;
};

// Show the people and channels an excerpt mentions as chips, the way
// the article does. Works on escaped HTML; a highlighted word is left
// as it is.
export const chipsHtml = (html: string, doc: SearchDocument) => {
  const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chip = (
    prefix: string,
    names: string[],
    className: string,
    current: string,
  ) =>
    [...new Set(names)]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .reduce(
        (out, name) =>
          out.replace(
            new RegExp(
              `(^|[\\s(])${escapeRegExp(prefix + escapeHtml(name))}(?=$|[\\s.,;:!?)…])`,
              "g",
            ),
            `$1<span class="${className}">${prefix}${escapeHtml(name)}</span>`,
          ),
        current,
      );
  return chip(
    "#",
    doc.channels ?? [],
    "slack_channel",
    chip("@", doc.mentions ?? [], "slack_user", html),
  );
};

export const dateLabel = (date: string) =>
  date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

export const cardHtml = (
  doc: SearchDocument,
  titleHtml: string,
  previewHtml: string,
) => {
  const isSlack = doc.url.startsWith("/slack/");
  const categoryLabel = isSlack
    ? `<span class="slack-column-badge">${escapeHtml(doc.category)}</span>`
    : doc.category
      ? escapeHtml(doc.category)
      : "";
  const byline = bylineHtml(doc);
  const date = dateLabel(doc.date);
  return `
      <a href="${doc.url}" class="front-block story-block search-result">
        <header class="story-card-header">
          <h3 class="story-block-title" data-vt-title="${titleTransitionName(doc.url)}">${titleHtml}</h3>
          ${date ? `<time class="story-card-date" datetime="${doc.date}">${date}</time>` : ""}
        </header>
        <p class="story-block-excerpt" data-vt-excerpt="${excerptTransitionName(doc.url)}">${chipsHtml(previewHtml, doc)}</p>
        <span class="reading-time">${categoryLabel ? categoryLabel + " · " : ""}${byline ? byline + " · " : ""}<span class="search-reading-time" data-vt-reading-time="${readingTimeTransitionName(doc.url)}">${doc.readingTime} min read</span></span>
      </a>`;
};
