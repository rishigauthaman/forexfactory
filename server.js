const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const port = Number(process.env.PORT || 4174);
const root = __dirname;
const feedUrls = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json",
];
const truthFeedUrls = ["https://www.trumpstruth.org/feed"];
const cachePath = path.join(root, "ff-cache.json");
const truthCachePath = path.join(root, "trump-truth-cache.json");
const zonesCachePath = path.join(root, "market-zones-cache.json");
const fallbackPath = path.join(root, "fallback-news.json");
const cacheMaxAgeMs = 60 * 60 * 1000;
const truthCacheMaxAgeMs = 5 * 60 * 1000;
const zonesCacheMaxAgeMs = 60 * 1000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

async function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    send(res, 200, body, mimeTypes[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}

async function readJsonFile(filePath) {
  const body = await fs.readFile(filePath, "utf8");
  return JSON.parse(body);
}

async function readFreshCache() {
  return readFreshJsonCache(cachePath, cacheMaxAgeMs);
}

async function readFreshTruthCache() {
  return readFreshJsonCache(truthCachePath, truthCacheMaxAgeMs);
}

async function readFreshZonesCache() {
  return readFreshJsonCache(zonesCachePath, zonesCacheMaxAgeMs);
}

async function readFreshJsonCache(filePath, maxAgeMs) {
  try {
    const stats = await fs.stat(filePath);
    if (Date.now() - stats.mtimeMs > maxAgeMs) return null;
    return readJsonFile(filePath);
  } catch {
    return null;
  }
}

async function readAnyCache() {
  try {
    return await readJsonFile(cachePath);
  } catch {
    return null;
  }
}

async function readAnyTruthCache() {
  try {
    return await readJsonFile(truthCachePath);
  } catch {
    return null;
  }
}

async function readAnyZonesCache() {
  try {
    return await readJsonFile(zonesCachePath);
  } catch {
    return null;
  }
}

async function readFallback() {
  try {
    return await readJsonFile(fallbackPath);
  } catch {
    return [];
  }
}

async function fetchCalendarExport() {
  let lastError = new Error("No feed URL tried");

  for (const url of feedUrls) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "USD-Impact-Scanner/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      if (!contentType.includes("json") && !text.trim().startsWith("[")) {
        throw new Error(`${url} did not return JSON`);
      }

      return JSON.parse(text);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeXml(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readTag(xml, tagName) {
  const escapedName = tagName.replace(":", "\\:");
  const match = xml.match(new RegExp(`<${escapedName}[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, "i"));
  return match ? decodeXml(match[1]).trim() : "";
}

function parseTruthFeed(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, 8).map((item) => {
    const text = stripTags(readTag(item, "description") || readTag(item, "title"));
    const url = readTag(item, "truth:originalUrl") || readTag(item, "link") || readTag(item, "guid");
    return {
      id: readTag(item, "truth:originalId") || url,
      text,
      url,
      publishedAt: readTag(item, "pubDate"),
      source: "Truth Social",
    };
  }).filter((post) => post.text && post.url);
}

async function fetchTruthExport() {
  let lastError = new Error("No Truth Social feed URL tried");

  for (const url of truthFeedUrls) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/rss+xml, application/xml, text/xml",
          "user-agent": "USD-Impact-Scanner/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
      }

      const text = await response.text();
      if (!text.includes("<rss") || !text.includes("<item>")) {
        throw new Error(`${url} did not return RSS`);
      }

      return parseTruthFeed(text);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function fetchForexFactory(res) {
  const freshCache = await readFreshCache();
  if (freshCache) {
    send(res, 200, JSON.stringify({ source: "cache", rows: freshCache }), "application/json; charset=utf-8");
    return;
  }

  try {
    const rows = await fetchCalendarExport();
    await fs.writeFile(cachePath, JSON.stringify(rows, null, 2));
    send(res, 200, JSON.stringify({ source: "live", rows }), "application/json; charset=utf-8");
  } catch (error) {
    const staleCache = await readAnyCache();
    if (staleCache) {
      send(res, 200, JSON.stringify({ source: "stale-cache", rows: staleCache }), "application/json; charset=utf-8");
      return;
    }

    const fallback = await readFallback();
    if (fallback.length) {
      send(res, 200, JSON.stringify({ source: "fallback", rows: fallback }), "application/json; charset=utf-8");
      return;
    }

    send(res, 502, JSON.stringify({ error: "Unable to fetch Forex Factory export", detail: error.message }), "application/json; charset=utf-8");
  }
}

async function fetchTrumpTruth(res) {
  const freshCache = await readFreshTruthCache();
  if (freshCache) {
    send(res, 200, JSON.stringify({ source: "cache", posts: freshCache }), "application/json; charset=utf-8");
    return;
  }

  try {
    const posts = await fetchTruthExport();
    await fs.writeFile(truthCachePath, JSON.stringify(posts, null, 2));
    send(res, 200, JSON.stringify({ source: "live", posts }), "application/json; charset=utf-8");
  } catch (error) {
    const staleCache = await readAnyTruthCache();
    if (staleCache) {
      send(res, 200, JSON.stringify({ source: "stale-cache", posts: staleCache }), "application/json; charset=utf-8");
      return;
    }

    send(res, 502, JSON.stringify({ error: "Unable to fetch Trump Truth feed", detail: error.message }), "application/json; charset=utf-8");
  }
}

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function createLiquidityZones(symbol, price) {
  const isBtc = symbol === "BTCUSD";
  const step = isBtc ? 250 : 5;
  const offsets = isBtc ? [0.004, 0.008, 0.0125, 0.02, 0.032] : [0.0025, 0.005, 0.0085, 0.013, 0.02];
  const zones = [];

  offsets.forEach((offset, index) => {
    const above = roundToStep(price * (1 + offset), step);
    const below = roundToStep(price * (1 - offset), step);
    const weight = Math.max(38, 100 - index * 13);

    zones.push({
      side: "Short liquidations",
      level: above,
      distancePct: ((above - price) / price) * 100,
      intensity: weight + (above % (step * 4) === 0 ? 8 : 0),
    });

    zones.push({
      side: "Long liquidations",
      level: below,
      distancePct: ((below - price) / price) * 100,
      intensity: weight + (below % (step * 4) === 0 ? 8 : 0),
    });
  });

  return zones.sort((a, b) => b.level - a.level);
}

async function fetchBtcPrice() {
  const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", {
    headers: { accept: "application/json", "user-agent": "USD-Impact-Scanner/1.0" },
  });
  if (!response.ok) throw new Error(`Binance returned ${response.status}`);
  const payload = await response.json();
  const price = Number(payload.price);
  if (!Number.isFinite(price)) throw new Error("Binance returned an invalid BTC price");
  return price;
}

async function fetchXauPrice() {
  const response = await fetch("https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=json", {
    headers: { accept: "application/json", "user-agent": "USD-Impact-Scanner/1.0" },
  });
  if (!response.ok) throw new Error(`Stooq returned ${response.status}`);
  const text = await response.text();
  const match = text.match(/"close":([0-9.]+)/);
  const price = Number(match?.[1]);
  if (!Number.isFinite(price)) throw new Error("Stooq returned an invalid XAU price");
  return price;
}

async function fetchMarketZones(res) {
  const freshCache = await readFreshZonesCache();
  if (freshCache) {
    send(res, 200, JSON.stringify({ source: "cache", ...freshCache }), "application/json; charset=utf-8");
    return;
  }

  try {
    const [btcPrice, xauPrice] = await Promise.all([fetchBtcPrice(), fetchXauPrice()]);
    const payload = {
      updatedAt: new Date().toISOString(),
      markets: [
        { symbol: "BTCUSD", price: btcPrice, zones: createLiquidityZones("BTCUSD", btcPrice) },
        { symbol: "XAUUSD", price: xauPrice, zones: createLiquidityZones("XAUUSD", xauPrice) },
      ],
    };
    await fs.writeFile(zonesCachePath, JSON.stringify(payload, null, 2));
    send(res, 200, JSON.stringify({ source: "live", ...payload }), "application/json; charset=utf-8");
  } catch (error) {
    const staleCache = await readAnyZonesCache();
    if (staleCache) {
      send(res, 200, JSON.stringify({ source: "stale-cache", ...staleCache }), "application/json; charset=utf-8");
      return;
    }

    send(res, 502, JSON.stringify({ error: "Unable to fetch market zones", detail: error.message }), "application/json; charset=utf-8");
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/forex-factory")) {
    fetchForexFactory(res);
    return;
  }

  if (req.url.startsWith("/api/trump-truth")) {
    fetchTrumpTruth(res);
    return;
  }

  if (req.url.startsWith("/api/market-zones")) {
    fetchMarketZones(res);
    return;
  }

  serveFile(req, res);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`USD scanner running on port ${port}`);
});
