// /api/prices?ticker=SPY
// Proxies the Yahoo Finance chart API (the same endpoint the yfinance
// Python library uses). Tries query1 then query2 hosts. On failure returns
// a JSON error with the upstream status — the frontend surfaces it and
// leaves the ticker blank. No mock data, ever.

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

export default async function handler(req, res) {
  const ticker = (req.query.ticker || '').trim().toUpperCase();

  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(ticker)) {
    res.status(400).json({ error: 'Invalid ticker' });
    return;
  }

  let lastErr = 'unknown';
  for (const host of HOSTS) {
    const url =
      `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?range=3y&interval=1d&includeAdjustedClose=true`;
    try {
      const upstream = await fetch(url, { headers: HEADERS });
      if (!upstream.ok) {
        lastErr = `Yahoo ${host} HTTP ${upstream.status}`;
        continue;
      }
      const data = await upstream.json();
      const result = data?.chart?.result?.[0];
      const timestamps = result?.timestamp;
      const quote = result?.indicators?.quote?.[0]?.close;
      const adj = result?.indicators?.adjclose?.[0]?.adjclose;
      const closes = adj && adj.length ? adj : quote;

      if (!timestamps || !closes) {
        lastErr = data?.chart?.error?.description || 'No data in response';
        continue;
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
        res.status(404).json({ error: `Insufficient history (${rows.length} bars)` });
        return;
      }

      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      res.status(200).json({ ticker, closes: rows.slice(-800) });
      return;
    } catch (e) {
      lastErr = `${host}: ${e.message}`;
    }
  }
  res.status(502).json({ error: lastErr });
}
