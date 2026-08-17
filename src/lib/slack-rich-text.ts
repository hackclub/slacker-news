export type Token =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; name: string }
  | { type: "channel"; id: string; name?: string }
  | { type: "channel-candidate"; value: string }
  | { type: "link"; url: string; label: string }
  | { type: "emoji"; name: string }
  | { type: "bold" | "italic"; children: Token[] };

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
      character === "_"
      && (!/\w/.test(previous) || !/\w/.test(next))
    ) {
      italicOpen = !italicOpen;
    }
  }

  return `${truncated}${italicOpen ? "_" : ""}${boldOpen ? "*" : ""}`;
}
