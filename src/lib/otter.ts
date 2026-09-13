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
  projects_by_month?: Array<{ period?: string; total_projects?: number; total_hours?: number }>;
};

let cache: { value: TickerFigure[]; expiresAt: number } | undefined;
let inFlight: Promise<TickerFigure[]> | undefined;

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function monthlyTotals(
  rows: OtterStats["projects_by_month"],
  field: "total_projects" | "total_hours",
): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const row of rows ?? []) {
    if (!row.period) continue;
    totals.set(row.period, (totals.get(row.period) ?? 0) + (row[field] ?? 0));
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// Last complete month's contribution to this metric, as a share of its
// current cumulative total. The newest bucket is the current, partial
// month, so use the one before it.
function changeFromLastMonth(
  rows: OtterStats["projects_by_month"],
  field: "total_projects" | "total_hours",
  cumulativeTotal: number | undefined,
): TickerFigure["change"] | undefined {
  if (!cumulativeTotal) return undefined;
  const lastCompleteMonth = monthlyTotals(rows, field).at(-2);
  if (!lastCompleteMonth || lastCompleteMonth[1] <= 0) return undefined;

  const percent = Math.round((lastCompleteMonth[1] / cumulativeTotal) * 100);
  if (percent === 0) return undefined;
  return { direction: "up", text: `${percent}%` };
}

function monthLabel(period: string): string {
  const parsed = new Date(`${period}T00:00:00Z`);
  return parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
}

function toFigures(stats: OtterStats): TickerFigure[] {
  const overview = stats.overview ?? {};
  const figures: TickerFigure[] = [];

  const pushOverviewFigure = (label: string, value: number | undefined, change?: TickerFigure["change"]) => {
    if (!value) return;
    figures.push({ label, value: wholeNumber.format(value), change });
  };

  pushOverviewFigure(
    "Projects shipped",
    overview.total_projects,
    changeFromLastMonth(stats.projects_by_month, "total_projects", overview.total_projects),
  );
  pushOverviewFigure(
    "Hours logged",
    overview.total_hours,
    changeFromLastMonth(stats.projects_by_month, "total_hours", overview.total_hours),
  );
  // No monthly breakdown exists for countries, so no real change to show.
  pushOverviewFigure("Countries", overview.total_countries);

  // The newest bucket is the current, partial month, so compare the two months
  // before it — otherwise every reading looks like a collapse.
  const months = monthlyTotals(stats.projects_by_month, "total_projects");
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
