"""Historical Replay V2 (work package S5).

* presets    — deterministic choice of a past window matching a market regime (never the last bars).
* outcomes   — resolution of LONG/SHORT predictions and WAIT decisions on the REVEALED candles only.
* scoring    — explainable 0–100 score per decision + flags (chased, entered too early, ignored structure …).
* comparison — "what a rule-based strategy would have done" over the same window (same costs).
* review     — the AI HISTORY REVIEW built at finish (offline, deterministic; optional LLM narration).
* indicators — indicators computed on the visible slice only (no lookahead).

Everything here is educational and PAPER only: no module in this package can place a real order.
"""
