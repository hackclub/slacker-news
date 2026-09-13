import type { TickerFigure } from "./otter";

const STATS_URL = "https://slack-data.hackclub.dev/full";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;

type SlackDataStats = {
  membership?: {
    total_members?: { number?: number; change_in_percentage?: number };
    monthly_active_users?: { number?: number; change_in_percentage?: number };
  };
  stats?: Array<{ channels_count?: number }>;
};

let cache: { value: TickerFigure[]; expiresAt: number } | undefined;
let inFlight: Promise<TickerFigure[]> | undefined;

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function changeFromPercentage(percentage: number | undefined): TickerFigure["change"] | undefined {
  if (percentage === undefined) return undefined;
  const rounded = Math.round(percentage);
  if (rounded === 0) return undefined;
  return { direction: rounded > 0 ? "up" : "down", text: `${Math.abs(rounded)}%` };
}

function channelsFigure(rows: SlackDataStats["stats"]): TickerFigure | undefined {
  const counts = (rows ?? [])
    .map((row) => row.channels_count)
    .filter((count): count is number => typeof count === "number");
  if (counts.length === 0) return undefined;

  const first = counts[0];
  const last = counts[counts.length - 1];
  const figure: TickerFigure = { label: "Channels", value: wholeNumber.format(last) };

  if (first > 0) {
    const percent = Math.round(((last - first) / first) * 100);
    if (percent !== 0) {
      figure.change = { direction: percent > 0 ? "up" : "down", text: `${Math.abs(percent)}%` };
    }
  }

  return figure;
}

function toFigures(stats: SlackDataStats): TickerFigure[] {
  const membership = stats.membership ?? {};
  const figures: TickerFigure[] = [];

  if (membership.total_members?.number) {
    figures.push({
      label: "Members",
      value: wholeNumber.format(membership.total_members.number),
      change: changeFromPercentage(membership.total_members.change_in_percentage),
    });
  }

  if (membership.monthly_active_users?.number) {
    figures.push({
      label: "Monthly active",
      value: wholeNumber.format(membership.monthly_active_users.number),
      change: changeFromPercentage(membership.monthly_active_users.change_in_percentage),
    });
  }

  const channels = channelsFigure(stats.stats);
  if (channels) figures.push(channels);

  return figures;
}

async function loadFigures(): Promise<TickerFigure[]> {
  const response = await fetch(STATS_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`slack-data responded ${response.status}`);
  return toFigures((await response.json()) as SlackDataStats);
}

export async function getSlackDataFigures(): Promise<TickerFigure[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (inFlight) return inFlight;

  inFlight = loadFigures()
    .then((figures) => {
      cache = { value: figures, expiresAt: Date.now() + CACHE_TTL_MS };
      return figures;
    })
    .catch(() => cache?.value ?? [])
    .finally(() => {
      inFlight = undefined;
    });

  return inFlight;
}
