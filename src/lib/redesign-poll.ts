// The redesign poll at /redesign-poll. Each question puts one change from the
// redesign against what the site did before it. The site renders the new
// design; picking the old one adds the question's class to <html> in the
// preview frame, and src/styles/redesign-poll.scss puts the old look back.
// Delete this file, the stylesheet, the page and the API route once the poll
// is over.

export type PollChoice = "new" | "old";

export interface PollQuestion {
  key: string;
  question: string;
  description?: string;
  newLabel: string;
  oldLabel: string;
  // Class added to <html> in the preview when "old" is picked.
  oldClass: string;
}

export const POLL_QUESTIONS: PollQuestion[] = [
  {
    key: "colour",
    question: "Colour",
    description: "Emoji, Slack mentions and video stills.",
    newLabel: "Full colour, always",
    oldLabel: "Grey until hovered",
    oldClass: "poll-old-colour",
  },
  {
    key: "emoji",
    question: "Animated emoji",
    newLabel: "Emoji animate",
    oldLabel: "Emoji stay still",
    oldClass: "poll-old-emoji",
  },
  {
    key: "authors",
    question: "Authors on the homepage",
    newLabel: "Byline beside each story",
    oldLabel: "No bylines",
    oldClass: "poll-old-authors",
  },
  {
    key: "avatars",
    question: "Profile pictures",
    description: "Small Slack pictures beside authors' names.",
    newLabel: "Show profile pictures",
    oldLabel: "Names only",
    oldClass: "poll-old-avatars",
  },
  {
    key: "cards",
    question: "Homepage stories",
    newLabel: "Open, no boxes",
    oldLabel: "Each story in a box",
    oldClass: "poll-old-cards",
  },
  {
    key: "width",
    question: "Homepage width",
    newLabel: "Wide",
    oldLabel: "Narrow, like articles",
    oldClass: "poll-old-width",
  },
  {
    key: "masthead",
    question: "Masthead",
    newLabel: "Tinted newswire band, no rules",
    oldLabel: "Black rules above and below",
    oldClass: "poll-old-masthead",
  },
  {
    key: "paper",
    question: "Background",
    newLabel: "One paper colour everywhere",
    oldLabel: "White masthead, footer and boxes",
    oldClass: "poll-old-paper",
  },
  {
    key: "headings",
    question: "Section headings",
    newLabel: "Ruled row above the stories",
    oldLabel: "Name in the left margin",
    oldClass: "poll-old-headings",
  },
];

export const POLL_STORAGE_KEY = "redesign-poll";
export const POLL_PATH = "/redesign-poll";

export interface PollVote {
  choices: Record<string, PollChoice>;
  comments: string;
}

const MAX_COMMENT_LENGTH = 2000;

// Checks a submitted vote: every question answered "new" or "old", nothing
// else, and a comment of reasonable length. Returns null if it is not valid.
export function parsePollVote(input: unknown): PollVote | null {
  if (!input || typeof input !== "object") return null;
  const { choices, comments } = input as Record<string, unknown>;
  if (!choices || typeof choices !== "object") return null;

  const parsed: Record<string, PollChoice> = {};
  for (const { key } of POLL_QUESTIONS) {
    const value = (choices as Record<string, unknown>)[key];
    if (value !== "new" && value !== "old") return null;
    parsed[key] = value;
  }
  if (Object.keys(choices).length !== POLL_QUESTIONS.length) return null;

  const comment = comments ?? "";
  if (typeof comment !== "string" || comment.length > MAX_COMMENT_LENGTH) {
    return null;
  }

  return { choices: parsed, comments: comment.trim() };
}
