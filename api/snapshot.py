"""
/api/snapshot?tickers=SPY,QQQ,...  —  live closes feed for the Contrarian Scanner.

Same pattern as the Intermarket Action Sheet's api/daily-snapshot.py:
  * Vercel Python serverless function (BaseHTTPRequestHandler)
  * pulls from Yahoo Finance with yfinance (batched yf.download, threads=True)
  * caches in-memory on warm instances + on the CDN edge
  * returns: { "SPY": [ {"d":"YYYY-MM-DD","c":123.45}, ... ], "QQQ": [...] }

Closes only (the scanner needs nothing else). auto_adjust=True →
dividend/split-adjusted closes, yfinance's default and the honest series
for drawdown math. Tickers that fail are simply absent from the response —
the frontend shows them as "No data". Never mocked.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import math
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

YEARS_HISTORY = 4        # scanner uses last ~800 bars (~3.2y); 4y gives buffer
CHUNK = 25               # batch size — one bad ticker can't sink the rest
MAX_TICKERS = 160
MIN_BARS = 252

# in-memory cache (survives across warm invocations of the same instance)
_cache = {}              # key -> {"data": dict, "ts": datetime}
CACHE_SECONDS = 21600    # 6 hours — daily closes change once per day


def _closes_from_frame(df: pd.DataFrame) -> list:
    """Single-ticker OHLC frame -> [{"d": date, "c": close}, ...]."""
    if df is None or df.empty or "Close" not in df.columns:
        return []
    # bounded ffill: bridges real 1-5 day gaps but cannot fabricate a flat
    # tail/head for tickers that were NaN-padded onto the batch's shared index
    s = df["Close"].ffill(limit=5).dropna()
    bars = []
    for ts, v in s.items():
        v = float(v)
        if math.isnan(v):
            continue
        bars.append({"d": ts.strftime("%Y-%m-%d"), "c": round(v, 6)})
    return bars


def build_snapshot(tickers: list) -> dict:
    start = (datetime.utcnow() - timedelta(days=int(YEARS_HISTORY * 365.25))
             ).strftime("%Y-%m-%d")
    out: dict = {}
    for i in range(0, len(tickers), CHUNK):
        batch = tickers[i:i + CHUNK]
        try:
            raw = yf.download(
                batch,
                start=start,
                interval="1d",
                auto_adjust=True,
                group_by="ticker",
                threads=True,
                progress=False,
            )
        except Exception as e:
            print(f"chunk {batch[0]}.. failed: {e}")
            continue
        if raw is None or raw.empty:
            continue
        if isinstance(raw.columns, pd.MultiIndex):
            present = set(raw.columns.get_level_values(0).unique())
            for sym in batch:
                if sym not in present:
                    continue
                bars = _closes_from_frame(raw[sym])
                if len(bars) >= MIN_BARS:
                    out[sym] = bars[-820:]
        else:
            # single surviving ticker collapses to a flat frame
            bars = _closes_from_frame(raw)
            if len(bars) >= MIN_BARS and batch:
                out[batch[0]] = bars[-820:]
    return out


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            raw = (qs.get("tickers", [""])[0] or "").upper()
            tickers, seen = [], set()
            for t in raw.split(","):
                t = t.strip()
                if t and t not in seen:
                    seen.add(t)
                    tickers.append(t)
            tickers = tickers[:MAX_TICKERS]
            if not tickers:
                raise ValueError("no tickers provided — use ?tickers=SPY,QQQ,...")

            key = ",".join(sorted(tickers))
            ent = _cache.get(key)
            if ent is None or (datetime.utcnow() - ent["ts"]).total_seconds() > CACHE_SECONDS:
                ent = {"data": build_snapshot(tickers), "ts": datetime.utcnow()}
                _cache[key] = ent

            body = json.dumps(ent["data"], separators=(",", ":"))
            status = 200
        except Exception as e:
            import traceback
            body = json.dumps({"error": str(e), "traceback": traceback.format_exc()})
            status = 500

        self.send_response(status)
        self.send_header("Content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control",
                         "public, s-maxage=21600, stale-while-revalidate=86400")
        self.end_headers()
        self.wfile.write(body.encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def log_message(self, *args):
        pass
