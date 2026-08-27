import { mkdir, writeFile } from "node:fs/promises";
import { mapOddsToFixtures, seasonCode } from "../odds.mjs";

const API = "https://fantasy.premierleague.com/api";
const headers = {
  "User-Agent": "FPL-Optimal-XI/3.0 (+https://kwkhong.github.io/fpl-squad-optimiser/)",
  Accept: "application/json",
};

async function getJson(path) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${API}${path}`, {
        headers,
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

async function getText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

const [bootstrap, fixtures] = await Promise.all([
  getJson("/bootstrap-static/"),
  getJson("/fixtures/"),
]);

if (!Array.isArray(bootstrap.elements) || bootstrap.elements.length < 300) {
  throw new Error("Player feed is missing or unexpectedly small");
}
if (!Array.isArray(bootstrap.teams) || bootstrap.teams.length !== 20) {
  throw new Error("Team feed must contain 20 clubs");
}
if (!Array.isArray(bootstrap.events) || !bootstrap.events.length) {
  throw new Error("Gameweek feed is missing");
}
if (!Array.isArray(fixtures) || fixtures.length < 100) {
  throw new Error("Fixture feed is missing or unexpectedly small");
}

const completedEvents = bootstrap.events
  .filter((event) => event.finished)
  .map((event) => event.id)
  .sort((a, b) => a - b)
  .slice(-12);
const liveEvents = [];
for (let index = 0; index < completedEvents.length; index += 4) {
  const batch = completedEvents.slice(index, index + 4);
  liveEvents.push(...await Promise.all(batch.map(async (event) => ({
    event,
    data: await getJson(`/event/${event}/live/`),
  }))));
}
const historyByPlayer = {};
const fields = [
  "minutes", "total_points", "expected_goals", "expected_assists",
  "goals_scored", "assists", "bonus", "bps", "clean_sheets", "saves",
  "goals_conceded", "yellow_cards", "red_cards", "starts",
];

for (const { event, data } of liveEvents) {
  for (const element of data.elements || []) {
    const stats = { event };
    for (const field of fields) stats[field] = Number(element.stats?.[field] || 0);
    (historyByPlayer[element.id] ||= []).push(stats);
  }
}

const oddsUrls = [
  `https://www.football-data.co.uk/mmz4281/${seasonCode()}/E0.csv`,
  "https://www.football-data.co.uk/fixtures.csv",
];
const oddsTexts = [];
for (const url of oddsUrls) {
  try {
    oddsTexts.push(await getText(url));
  } catch (error) {
    console.warn(`Optional bookmaker feed unavailable: ${error.message}`);
  }
}
const teams = new Map(bootstrap.teams.map((team) => [team.id, team]));
const oddsByFixture = mapOddsToFixtures(oddsTexts, fixtures, teams);

const payload = {
  schemaVersion: 4,
  modelVersion: "3.1.0",
  updatedAt: new Date().toISOString(),
  source: "Official Fantasy Premier League API",
  bootstrap,
  fixtures,
  historyEvents: completedEvents,
  historyByPlayer,
  oddsByFixture,
  oddsSource: "Football-Data.co.uk market-average 1X2 odds",
  modelMetrics: null,
};

await mkdir("data", { recursive: true });
await writeFile("data/fpl.json", JSON.stringify(payload));
console.log(
  `Validated ${bootstrap.elements.length} players, ${bootstrap.teams.length} clubs, ` +
  `${fixtures.length} fixtures, ${Object.keys(oddsByFixture).length} bookmaker markets and ` +
  `${completedEvents.length} gameweeks at ${payload.updatedAt}`
);
