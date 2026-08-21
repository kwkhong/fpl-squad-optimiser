# FPL Optimal XI

A responsive, browser-based Fantasy Premier League decision tool. It loads the
official public FPL player feed, builds a legal 15-player squad, selects a
starting XI and captain, and can compare the recommendation with a public FPL
team ID.

## What it does

- Uses live player prices, form, availability, expected involvement and ICT data
- Enforces the FPL 2 GK / 5 DEF / 5 MID / 3 FWD squad structure
- Enforces the three-player-per-club rule and user-defined budget
- Selects a legal starting formation and captain/vice-captain
- Supports safe, balanced and differential strategies
- Imports a public team by FPL ID and proposes up to three changes
- Falls back to clearly labelled demonstration data if the public feed is blocked

## Run locally

No build step is required. Serve the directory with any static server, for example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deployment

The included GitHub Pages workflow deploys the site whenever changes reach the
`main` branch. In repository settings, set **Pages → Source** to **GitHub Actions**.

## Method note

The optimiser uses repeated constrained search plus local player swaps. It is a
decision-support projection, not a guarantee of future points. Review late injury,
rotation and fixture news before locking a team.
