# DL Contrarian Scanner

Price-based contrarian ETF scanner for DeLorean Partners. Identifies Stage 1 basing setups across an ETF universe using three mechanical conditions.

---

## What it does

Screens an ETF universe for assets that are showing classic exhaustion-bottom patterns:

1. **C1 — Drawdown ≥ 30% from 3Y high** — meaningfully punished, weak hands have capitulated
2. **C2 — No new 252-day low for 90+ days** — sellers exhausted, refusal to make new lows
3. **C3 — 6-month range < 15% of average price** — volatility compression, accumulation zone

An asset that meets all three is a **3/3 contrarian setup** — a candidate for Wyckoff/Weinstein Stage 1 → Stage 2 transition.

The dashboard surfaces individual setups, regime composites (universe-wide stress and setup density), and the full distribution of conditions across the scanned universe.

---

## Quick start

### Local

```bash
# From the project folder
npx serve .
# Or just double-click index.html
```

### Deploy to Vercel

```bash
# First time
npm i -g vercel
vercel login

# Deploy
vercel --prod
```

That's it. No build step, no env vars, no backend.

---

## File structure

```
dl-contrarian-scanner/
├── index.html        # The entire app (single file, vanilla JS)
├── api/
│   └── prices.js     # Serverless proxy → Yahoo Finance (yfinance endpoint)
├── vercel.json       # Static site config
├── package.json      # Project marker
├── .gitignore
└── README.md
```

---

## How to use

1. Open the deployed URL
2. Click **Run Scan** — pulls ~3 years of daily closes for the 50-ticker default universe from Yahoo Finance; tickers that fail to load show as "No data" and are excluded
3. Adjust the three sliders to retune thresholds (no re-fetch needed, recomputes locally)
4. Four tabs:
   - **Dashboard** — composite cards (Setup Density, Universe Stress) + sortable scan results table
   - **Distribution** — score histogram, drawdown distribution, days-since-low distribution, top extremes
   - **Pairs** — relative-value ratio analysis (see below)
   - **Methodology** — explains the three conditions in detail

Click any row in the results table to expand the detail breakdown for that ticker.

---

## Universe

Default 50 ETFs covering:

- **US Broad** — SPY, QQQ, IWM, DIA
- **All 11 sectors** — XLE, XLF, XLK, XLV, XLI, XLU, XLP, XLY, XLB, XLRE, XLC
- **Themes** — XBI, XOP, XME, XHB, KRE, SMH, IBB, ITA, JETS, TAN, LIT, URA
- **DM** — EFA, EWJ, EWG, EWU, EWC, EWA
- **EM** — EEM, VWO, EWZ, INDA, FXI, KWEB, EWW, EZA, TUR, EWY, EWT
- **Commodities** — GLD, SLV, USO, UNG, DBA
- **Bonds** — TLT

To customize the universe: click **Edit Universe** in the UI. Format is `TICKER,Display Name`, one per line.

---

## Data source

**Yahoo Finance** — the same chart endpoint the `yfinance` Python library uses, accessed through a Vercel serverless proxy at `/api/prices.js` (no API key, no CORS issues, edge-cached for 1 hour).

Fetch path per ticker:

1. `/api/prices?ticker=SPY` (serverless proxy → `query1.finance.yahoo.com/v8/finance/chart/`)
2. If the proxy is unreachable (e.g., opening `index.html` directly without `vercel dev`), a direct Yahoo request is attempted as a fallback
3. If both fail → the ticker is marked **No data**, shown blank in the table, and excluded from composites and distributions

**There is no mock data.** The previous Stooq + mock-fallback layer has been removed entirely; a failed ticker can never silently display synthetic prices.

### Running locally

Because the data path goes through a serverless function, plain `npx serve .` won't have `/api`. Use:

```bash
npm i -g vercel
vercel dev
```

(The direct-Yahoo fallback may work in some environments without it, but `vercel dev` is the reliable local path.)

### Known limitations

- **Coverage** — Yahoo covers US-listed ETFs and most international symbols (use Yahoo suffixes like `.L`, `.HK` for non-US listings).
- **EOD only** — daily close data; the chart endpoint's last bar may be the current partial session during market hours.
- **Rate limits** — Yahoo occasionally throttles; the 80ms inter-ticker delay plus the 1h edge cache keeps a 50-ticker scan well within tolerance.

## When to upgrade the data layer

`/api/prices.js` already proxies Yahoo Finance. If a paid/contractual source is preferred (Polygon, FactSet), swap the upstream URL and response parsing inside that one file — the frontend contract (`{ closes: [{date, close}] }`) stays the same. Ask Amit if/when this becomes needed.

## Methodology — the contrarian thesis

This is **Weinstein's Stage 1 basing** quantified. The hypothesis: assets that have

1. Already absorbed major selling pressure (deep drawdown)
2. Stopped making new lows for a meaningful period
3. Compressed into a tight range

…are statistically more likely to enter Stage 2 (markup) than to break down further. Strong hands accumulating from weak hands at stable prices.

### Important caveat

This is an **entry candidate** screen, not an entry trigger. A 30% drawdown can become a 50% drawdown. For DL Partners' momentum-first philosophy:

- Use this scanner to build the **watchlist**
- Wait for momentum confirmation (price > 50DMA, 50DMA flattening or rising) before sizing
- The contrarian score gets them on the radar; momentum signal triggers the trade

Otherwise you'll catch falling knives.

---

## Pairs tab — relative contrarian plays

Beyond absolute setups, the **Pairs** tab asks: *within an asset class, what is maximally punished relative to its peer?* It computes the full-history price ratio (~800 trading days) for ~22 curated pairs grouped by class:

- **Equity style** — IWM/SPY, QQQ/SPY, XLU/SPY
- **Region** — EEM/SPY, EFA/SPY, FXI/EEM, EWZ/EEM, INDA/EEM, EWJ/EFA
- **Sector** — XLE/SPY, XLF/SPY, KRE/XLF, SMH/QQQ, XBI/XLV, TAN/XLE, XME/XLB
- **Commodity** — GLD/SLV, USO/GLD, UNG/USO, DBA/GLD
- **Cross-asset** — TLT/SPY, GLD/SPY

For each pair: current ratio, range position (0 = floor, 100 = ceiling), z-score vs mean, days since the ratio's last new low/high, and 12-month ratio change. The allocation lens is mechanical:

- **Range position ≤ 20** → ratio near floor → numerator maximally punished → **FAVOR numerator** (mean reversion of the ratio works in its favor)
- **Range position ≥ 80** → ratio near ceiling → **FAVOR denominator**
- Otherwise → mid-range, no relative edge

Click a pair to expand the full-history ratio chart with floor/ceiling bands. Pairs are computed from the same Yahoo Finance fetch as the main scan (legs not in the universe are fetched automatically); a pair with a missing leg shows "No data" and is excluded — never mocked. Edit the pair list via **Edit Pairs** (format: `NUM/DEN,Label,Asset Class`).

The same caveat as the main screen applies, doubly: a cheap ratio can get cheaper. Use pair signals as a relative-overweight watchlist, not a pair-trade trigger.

## Composite scoring (the dashboard cards)

**Setup Density** maps `% of universe with 3/3 setups` to a -100 to +100 scale:
- 0% setups → −100 (Euphoria)
- 25%+ setups → +100 (Capitulation)

**Universe Stress** maps the median drawdown across the universe:
- 0% median DD → −100 (Stretched High)
- −30% median DD → +100 (Broad Fear)

These are intentionally simple, mechanical, and re-tunable. Adjust the sliders and watch the composites swing.

---

## Tech stack

- Single HTML file, vanilla JS, no framework, no build step
- Source Serif 4 (display) + JetBrains Mono (data) from Google Fonts
- Yahoo Finance chart API via /api/prices serverless proxy
- Vercel for hosting (static + one serverless function)

---

## Contact

Project owner: Amit Bhartia (DeLorean Partners)
Implementation: Jermaine
