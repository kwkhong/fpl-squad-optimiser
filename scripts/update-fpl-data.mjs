import { mkdir, writeFile } from "node:fs/promises";

const API = "https://fantasy.premierleague.com/api";
const headers = {
  "User-Agent": "FPL-Optimal-XI/1.0 (+https://kwkhong.github.io/fpl-squad-optimiser/)",
  Accept: "application/json",
};

async function getJson(path) {
  const response = await fetch(`${API}${path}`, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
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

const payload = {
  updatedAt: new Date().toISOString(),
  source: "Official Fantasy Premier League API",
  bootstrap,
  fixtures,
};

await mkdir("data", { recursive: true });
await writeFile("data/fpl.json", JSON.stringify(payload));
console.log(
  `Validated ${bootstrap.elements.length} players, ${bootstrap.teams.length} clubs and ${fixtures.length} fixtures at ${payload.updatedAt}`
);
