import type { TickerFigure } from "./otter";

const CLUBS_URL = "https://clubapi.hackclub.com/clubs";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;

type ClubsResponse = { totalClubs?: number };

let cache: { value: TickerFigure[]; expiresAt: number } | undefined;
let inFlight: Promise<TickerFigure[]> | undefined;

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

async function loadFigures(): Promise<TickerFigure[]> {
  const response = await fetch(CLUBS_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`clubapi responded ${response.status}`);

  const { totalClubs } = (await response.json()) as ClubsResponse;
  // The API only reports the current total, so there is no change to show.
  return totalClubs ? [{ label: "Clubs", value: wholeNumber.format(totalClubs) }] : [];
}

export async function getClubsFigures(): Promise<TickerFigure[]> {
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
