export type Token =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; name: string }
  | { type: "channel"; id: string; name?: string }
  | { type: "channel-candidate"; value: string }
  | { type: "link"; url: string; label: string }
  | { type: "emoji"; name: string }
  | { type: "bold" | "italic"; children: Token[] };
