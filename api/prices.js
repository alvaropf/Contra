// /api/prices?ticker=SPY
// Proxies the Yahoo Finance chart API (the same endpoint the yfinance
// Python library uses) so the browser avoids CORS. No API key needed.
// Returns: { ticker, closes: [{ date: "YYYY-MM-DD", close: Number }, ...] }
// On any failure returns an error status — the frontend treats that
// ticker as "no data" and leaves it blank. No mock data, ever.

export default async function handler(req, res) {
  const ticker = (req.query.ticker || '').trim().toUpperCase();

  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(ticker)) {
    res.status(400).json({ error: 'Invalid ticker' });
    return;
  }

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=3y&interval=1d&events=div%2Csplit`;

  try {
    const upstream = await fetch(url, {
      headers: {
        // Yahoo rejects requests without a browser-like UA
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    if (!upstream.ok) {
      res.status(502).json({ error: `Yahoo HTTP ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;

    if (!timestamps || !closes || timestamps.length < 252) {
      res.status(404).json({ error: 'Insufficient data' });
      return;
    }

    const rows = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c === null || c === undefined || Number.isNaN(c)) continue;
      rows.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        close: c,
      });
    }

    if (rows.length < 252) {
      res.status(404).json({ error: 'Insufficient data' });
      return;
    }

    // Cache at the edge for 1h — EOD data doesn't change intraday enough to matter
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ ticker, closes: rows.slice(-800) });
  } catch (e) {
    res.status(502).json({ error: 'Fetch failed' });
  }
}
