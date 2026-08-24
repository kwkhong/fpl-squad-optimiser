const FPL_API = "https://fantasy.premierleague.com/api";
const ALLOWED_ORIGINS = new Set([
  "https://kwkhong.github.io",
  "https://fpl-squad-optimiser.vercel.app",
]);

function setCors(req, res) {
  const origin = req.headers?.origin;
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const teamId = Number(req.query?.teamId);
  const currentEvent = Number(req.query?.event);
  if (!Number.isInteger(teamId) || teamId < 1 || !Number.isInteger(currentEvent) || currentEvent < 1 || currentEvent > 38) {
    return res.status(400).json({ error: "A valid Team ID and gameweek are required." });
  }

  const candidates = [...new Set([currentEvent, Math.max(1, currentEvent - 1)])];
  for (const event of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${FPL_API}/entry/${teamId}/event/${event}/picks/`, {
        headers: { Accept: "application/json", "User-Agent": "FPL-Optimal-XI/1.0" },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data?.picks) && data.picks.length === 15) {
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return res.status(200).json(data);
      }
    } catch {
      // Try the last published gameweek before reporting a temporary failure.
    } finally {
      clearTimeout(timeout);
    }
  }

  return res.status(404).json({ error: "Public squad unavailable for this Team ID." });
}
