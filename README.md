# FPL Optimal XI

A responsive, browser-based Fantasy Premier League decision tool. It loads the
official public FPL player feed, builds a legal 15-player squad, selects a
starting XI and captain, and can compare the recommendation with a public FPL
team ID.

## What it does

- Uses official player prices, availability, xG/xA, starts, minutes, bonus and recent gameweek histories refreshed automatically every hour
- Scores the actual next 1, 3 or 5 gameweeks fixture by fixture with a recency-weighted Poisson team model
- Shrinks noisy per-90 rates toward position priors and models expected minutes, appearance probability and clean-sheet probability
- Enforces the FPL 2 GK / 5 DEF / 5 MID / 3 FWD squad structure
- Enforces the three-player-per-club rule and user-defined budget
- Deterministically optimises the starting XI, captain and weighted bench rather than treating all 15 slots equally
- Supports balanced, reliability-aware safe and low-ownership differential strategies without changing the displayed mean forecast
- Imports a public team by FPL ID and proposes up to three changes after free-transfer and four-point-hit costs
- Generates a browser-safe FPL snapshot during every deployment and hourly refresh
- Runs a rolling-origin backtest and publishes the latest out-of-sample error and rank-correlation metrics with the snapshot
- Shows when the deployed dataset was last updated
- Falls back to clearly labelled demonstration data only if the deployed snapshot is unavailable

## Run locally

No build step is required. Serve the directory with any static server, for example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deployment

The included GitHub Pages workflow downloads and validates the official FPL feeds,
packages the snapshot with the site, and deploys whenever changes reach `main`. It
also republishes automatically every hour. In repository settings, set
**Pages → Source** to **GitHub Actions**.

## Model and validation

Model v2 separates prediction from decision strategy. Expected points combine
appearance points, position-specific goal value, expected assists, Poisson clean-sheet
probability, saves, goals conceded, cards and empirically shrunk bonus rates. Recent
gameweeks influence expected minutes and form, while older team results receive less
weight. Squad construction uses deterministic beam search followed by legal local
improvement and scores the XI, captain and likely autosub value.

The deployment workflow backtests the model on the most recent eligible gameweeks
using only player statistics available before each predicted gameweek. It records MAE,
RMSE and rank correlation alongside a rolling-points baseline. Until 2026/27 has enough
completed gameweeks, validation falls back to a rolling 2024/25 test from the
[Vaastav Anand FPL Historical Dataset](https://github.com/vaastav/Fantasy-Premier-League),
which is derived from official FPL data and distributed under its repository licence.
Early-season samples are small, and official team-strength priors may still contain
information updated after a historic gameweek, so the backtest is monitoring evidence
rather than a guarantee of future performance. Predicted line-ups and betting odds are
not included because the app has no reliable, free, browser-safe source for them;
review late team news before locking a team.
