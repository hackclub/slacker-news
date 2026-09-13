const STATS_URL = "https://otter.shymike.dev/api/v1/stats";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;

export type TickerFigure = {
  label: string;
  value: string;
  change?: {
    direction: "up" | "down";
    text: string;
  };
};

type OtterStats = {
  overview?: {
    total_projects?: number;
    total_hours?: number;
    total_countries?: number;
  };
  projects_by_month?: Array<{ period?: string; total_projects?: number }>;
};

let cache: { value: TickerFigure[]; expiresAt: number } | undefined;
let inFlight: Promise<TickerFigure[]> | undefined;

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// TODO(miguel): Otter's overview totals are cumulative, so there's no real
// prior-period baseline to diff against yet. Miguel is building a stats API
// that will return genuine period-over-period changes for these figures —
// swap this placeholder map for that response as soon as it ships.
const MOCK_OVERVIEW_CHANGES: Record<string, TickerFigure["change"]> = {
  total_projects: { direction: "up", text: "4%" },
  total_hours: { direction: "up", text: "12%" },
  total_countries: { direction: "up", text: "1%" },
};

function monthlyTotals(rows: OtterStats["projects_by_month"]): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const row of rows ?? []) {
    if (!row.period) continue;
    totals.set(row.period, (totals.get(row.period) ?? 0) + (row.total_projects ?? 0));
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function monthLabel(period: string): string {
  const parsed = new Date(`${period}T00:00:00Z`);
  return parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
}

function toFigures(stats: OtterStats): TickerFigure[] {
  const overview = stats.overview ?? {};
  const figures: TickerFigure[] = [];

  const pushOverviewFigure = (key: string, label: string, value: number | undefined) => {
    if (!value) return;
    figures.push({
      label,
      value: wholeNumber.format(value),
      change: MOCK_OVERVIEW_CHANGES[key],
    });
  };

  pushOverviewFigure("total_projects", "Projects shipped", overview.total_projects);
  pushOverviewFigure("total_hours", "Hours logged", overview.total_hours);
  pushOverviewFigure("total_countries", "Countries", overview.total_countries);

  // The newest bucket is the current, partial month, so compare the two months
  // before it — otherwise every reading looks like a collapse.
  const months = monthlyTotals(stats.projects_by_month);
  const latest = months.at(-2);
  const previous = months.at(-3);

  if (latest && latest[1] > 0) {
    const figure: TickerFigure = {
      label: `${monthLabel(latest[0])} ships`,
      value: wholeNumber.format(latest[1]),
    };

    if (previous && previous[1] > 0) {
      const percent = Math.round(((latest[1] - previous[1]) / previous[1]) * 100);
      if (percent !== 0) {
        figure.change = {
          direction: percent > 0 ? "up" : "down",
          text: `${Math.abs(percent)}%`,
        };
      }
    }

    figures.push(figure);
  }

  return figures;
}

async function loadFigures(): Promise<TickerFigure[]> {
  const response = await fetch(STATS_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Otter stats responded ${response.status}`);
  return toFigures((await response.json()) as OtterStats);
}

export async function getTickerFigures(): Promise<TickerFigure[]> {
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
