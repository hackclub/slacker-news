export type Token =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; name: string }
  | { type: "channel"; id: string; name?: string }
  | { type: "channel-candidate"; value: string }
  | { type: "link"; url: string; label: string }
  | { type: "emoji"; name: string }
  | { type: "bold" | "italic"; children: Token[] };

/** Truncate Slack text without leaving bold or italic formatting unterminated. */
export function truncateSlackWords(input: string, count: number): string {
  const words = input.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= count) return input;

  const truncated = `${words.slice(0, count).join(" ")}...`;
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
