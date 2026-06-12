// /api/prices?ticker=SPY
// Data chain (all real data, never mock):
//   1. Yahoo Finance chart API with a cookie+crumb session (what yfinance does) —
//      query1 then query2 hosts
//   2. Stooq EOD CSV (server-side, no CORS issue, tolerant of datacenter IPs)
// If every source fails, returns an error and the frontend leaves the ticker blank.
// Response: { ticker, source: "yahoo"|"stooq", closes: [{date, close}] }

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

// Yahoo session cached across warm invocations
let session = { cookie: null, crumb: null, ts: 0 };

async function getYahooSession() {
  if (session.cookie && Date.now() - session.ts < 25 * 60 * 1000) return session;
  try {
    const r = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
    });
    const setCookie = r.headers.get('set-cookie');
    const cookie = setCookie ? setCookie.split(';')[0] : null;
    let crumb = null;
    if (cookie) {
      const c = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: { ...BASE_HEADERS, Cookie: cookie },
      });
      if (c.ok) {
        const t = (await c.text()).trim();
        if (t && !t.includes('<') && t.length < 32) crumb = t;
      }
    }
    session = { cookie, crumb, ts: Date.now() };
  } catch (e) {
    session = { cookie: null, crumb: null, ts: Date.now() };
  }
  return session;
}

function parseYahoo(data) {
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0]?.close;
  const adj = result?.indicators?.adjclose?.[0]?.adjclose;
  const closes = adj && adj.length ? adj : quote;
  if (!timestamps || !closes) return null;
  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c === null || c === undefined || Number.isNaN(c)) continue;
    rows.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: c });
  }
  return rows;
}

async function tryYahoo(ticker, errs) {
  const s = await getYahooSession();
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    let url =
      `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?range=3y&interval=1d&includeAdjustedClose=true`;
    if (s.crumb) url += `&crumb=${encodeURIComponent(s.crumb)}`;
    try {
      const headers = { ...BASE_HEADERS };
      if (s.cookie) headers.Cookie = s.cookie;
      const r = await fetch(url, { headers });
      if (!r.ok) { errs.push(`yahoo ${host.split('.')[0]} HTTP ${r.status}`); continue; }
      const rows = parseYahoo(await r.json());
      if (rows && rows.length >= 252) return rows;
      errs.push(`yahoo ${host.split('.')[0]} no data`);
    } catch (e) {
      errs.push(`yahoo ${host.split('.')[0]} ${e.message}`);
    }
  }
  return null;
}

async function tryStooq(ticker, errs) {
  // US-listed ETF/stock symbols on Stooq: lowercase + ".us"
  const sym = ticker.toLowerCase().replace(/[^a-z0-9.\-]/g, '') + '.us';
  const url = `https://stooq.com/q/d/l/?s=${sym}&i=d`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) { errs.push(`stooq HTTP ${r.status}`); return null; }
    const text = await r.text();
    const lines = text.trim().split('\n');
    if (lines.length < 253 || !lines[0].toLowerCase().startsWith('date')) {
      errs.push('stooq no data'); return null;
    }
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      const close = parseFloat(parts[4]);
      if (!parts[0] || Number.isNaN(close)) continue;
      rows.push({ date: parts[0], close });
    }
    return rows.length >= 252 ? rows : (errs.push('stooq insufficient'), null);
  } catch (e) {
    errs.push(`stooq ${e.message}`);
    return null;
  }
}

export default async function handler(req, res) {
  const ticker = (req.query.ticker || '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(ticker)) {
    res.status(400).json({ error: 'Invalid ticker' });
    return;
  }

  const errs = [];
  // ~3y of trading days; keep last 800 bars for parity with the frontend
  const yahoo = await tryYahoo(ticker, errs);
  if (yahoo) {
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ ticker, source: 'yahoo', closes: yahoo.slice(-800) });
    return;
  }
  const stooq = await tryStooq(ticker, errs);
  if (stooq) {
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ ticker, source: 'stooq', closes: stooq.slice(-800) });
    return;
  }
  res.status(502).json({ error: errs.join(' · ') });
}
