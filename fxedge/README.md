# FXEdge

FXEdge is the AgentForge forex decision dashboard. The presentation layer is intentionally rich and decision-oriented while the data layer remains source-aware.

Current live/reference inputs:
- Coinbase public exchange-rate feed for spot monitoring
- Frankfurter reference/history feed for range and volatility diagnostics
- XE Currency Converter used as an independent research cross-check outside the browser runtime

The UI never silently substitutes demo data. Missing macro, policy, positioning, event or bank-deposit evidence is displayed as unavailable/pending and should reduce conviction rather than be fabricated.
