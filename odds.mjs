const TEAM_ALIASES = new Map(Object.entries({
  "afc bournemouth": "bournemouth",
  "aston villa": "aston villa",
  "brighton and hove albion": "brighton",
  "coventry city": "coventry",
  "crystal palace": "crystal palace",
  "hull city": "hull",
  "ipswich town": "ipswich",
  "manchester city": "man city",
  "manchester united": "man united",
  "man utd": "man united",
  "newcastle united": "newcastle",
  "nottingham forest": "nottm forest",
  "nott m forest": "nottm forest",
  "tottenham hotspur": "tottenham",
  "spurs": "tottenham",
  "west ham united": "west ham",
  "wolverhampton wanderers": "wolves",
}));

export function normaliseTeamName(value) {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
  return TEAM_ALIASES.get(cleaned) || cleaned;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function validDecimalOdd(value) {
  const odd = Number(value);
  return Number.isFinite(odd) && odd > 1 && odd <= 1000 ? odd : null;
}

export function fairProbabilities(homeOdd, drawOdd, awayOdd) {
  const odds = [homeOdd, drawOdd, awayOdd].map(validDecimalOdd);
  if (odds.some((odd) => odd == null)) return null;
  const raw = odds.map((odd) => 1 / odd);
  const overround = raw.reduce((total, probability) => total + probability, 0);
  if (!Number.isFinite(overround) || overround <= 0) return null;
  return {
    home: raw[0] / overround,
    draw: raw[1] / overround,
    away: raw[2] / overround,
    overround,
  };
}

function rowOdds(row) {
  const sets = [
    ["AvgCH", "AvgCD", "AvgCA", "closing market average"],
    ["AvgH", "AvgD", "AvgA", "market average"],
    ["B365CH", "B365CD", "B365CA", "Bet365 closing"],
    ["B365H", "B365D", "B365A", "Bet365"],
  ];
  for (const [homeField, drawField, awayField, label] of sets) {
    const home = validDecimalOdd(row[homeField]);
    const draw = validDecimalOdd(row[drawField]);
    const away = validDecimalOdd(row[awayField]);
    const fair = fairProbabilities(home, draw, away);
    if (fair) return { home, draw, away, fair, label };
  }
  return null;
}

export function mapOddsToFixtures(csvTexts, fixtures, teams) {
  const teamsByName = new Map(Array.from(teams.values ? teams.values() : teams)
    .map((team) => [normaliseTeamName(team.name), team.id]));
  const rowsByPair = new Map();
  for (const text of csvTexts) {
    for (const row of parseCsv(text)) {
      if (row.Div !== "E0") continue;
      const homeId = teamsByName.get(normaliseTeamName(row.HomeTeam));
      const awayId = teamsByName.get(normaliseTeamName(row.AwayTeam));
      const odds = rowOdds(row);
      if (!homeId || !awayId || !odds) continue;
      rowsByPair.set(`${homeId}|${awayId}`, { homeId, awayId, ...odds });
    }
  }

  const output = {};
  for (const fixture of fixtures) {
    const match = rowsByPair.get(`${fixture.team_h}|${fixture.team_a}`);
    if (!match) continue;
    output[String(fixture.id)] = {
      home: match.home,
      draw: match.draw,
      away: match.away,
      fairHome: Number(match.fair.home.toFixed(6)),
      fairDraw: Number(match.fair.draw.toFixed(6)),
      fairAway: Number(match.fair.away.toFixed(6)),
      overround: Number(match.fair.overround.toFixed(6)),
      market: match.label,
    };
  }
  return output;
}

export function seasonCode(now = new Date()) {
  const date = new Date(now);
  const year = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${String(year).slice(-2)}${String(year + 1).slice(-2)}`;
}
