const events = [];
const truthPosts = [];
const forexFactoryFeed = "/api/forex-factory";
const trumpTruthFeed = "/api/trump-truth";
const marketZonesFeed = "/api/market-zones";
const localCacheKey = "usd-news-events";
const truthCacheKey = "trump-truth-posts";
const zonesCacheKey = "major-liquidity-zones";

const weights = {
  high: 3,
  medium: 2,
  low: 1,
};

const inverseGoodForUsd = new Set(["jobs"]);

const els = {
  refreshNews: document.querySelector("#refreshNews"),
  refreshSocial: document.querySelector("#refreshSocial"),
  refreshZones: document.querySelector("#refreshZones"),
  themeToggle: document.querySelector("#themeToggle"),
  time12: document.querySelector("#time12"),
  time24: document.querySelector("#time24"),
  showNews: document.querySelector("#showNews"),
  showTweets: document.querySelector("#showTweets"),
  showHeatmap: document.querySelector("#showHeatmap"),
  upcomingNews: document.querySelector("#upcomingNews"),
  pastNews: document.querySelector("#pastNews"),
  feedStatus: document.querySelector("#feedStatus"),
  truthStatus: document.querySelector("#truthStatus"),
  timezoneNote: document.querySelector("#timezoneNote"),
  newsList: document.querySelector("#newsList"),
  truthList: document.querySelector("#truthList"),
  eventCount: document.querySelector("#eventCount"),
  countdownAlert: document.querySelector("#countdownAlert"),
  folderFilterButtons: document.querySelectorAll("[data-folder-filter]"),
  btcZones: document.querySelector("#btcZones"),
  xauZones: document.querySelector("#xauZones"),
  btcZonesStatus: document.querySelector("#btcZonesStatus"),
  xauZonesStatus: document.querySelector("#xauZonesStatus"),
  xEmbedNotice: document.querySelector("#xEmbedNotice"),
  xBlockedCard: document.querySelector("#xBlockedCard"),
  headline: document.querySelector("#headline"),
  biasLabel: document.querySelector("#biasLabel"),
  usdMeter: document.querySelector("#usdMeter span"),
  xauSignal: document.querySelector("#xauSignal"),
  xauMove: document.querySelector("#xauMove"),
  xauReason: document.querySelector("#xauReason"),
  btcSignal: document.querySelector("#btcSignal"),
  btcMove: document.querySelector("#btcMove"),
  btcReason: document.querySelector("#btcReason"),
  xauWidget: document.querySelector("#xauWidget"),
  btcWidget: document.querySelector("#btcWidget"),
};

const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "your local timezone";
const savedTheme = localStorage.getItem("usd-news-theme") || "dark";
let timeFormat = localStorage.getItem("usd-news-time-format") || "24";
let newsView = localStorage.getItem("usd-news-calendar-view") || "upcoming";
let activeView = localStorage.getItem("usd-news-active-view") || "news";
let folderFilter = localStorage.getItem("usd-news-folder-filter") || "all";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("usd-news-theme", theme);
  els.themeToggle.innerHTML =
    theme === "light"
      ? '<span data-lucide="moon"></span> Dark'
      : '<span data-lucide="sun"></span> Light';
  if (window.lucide) lucide.createIcons();
  renderTradingViewWidgets(theme);
}

function applyTimeFormat(format) {
  timeFormat = format;
  localStorage.setItem("usd-news-time-format", format);
  els.time12.classList.toggle("active", format === "12");
  els.time24.classList.toggle("active", format === "24");
  render();
}

function toNumber(value) {
  if (value === "" || value == null) return null;
  const cleaned = String(value)
    .replace(/[%,$]/g, "")
    .replace(/k$/i, "")
    .replace(/m$/i, "")
    .replace(/b$/i, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferType(name) {
  const lower = name.toLowerCase();
  if (lower.includes("claim") || lower.includes("unemployment") || lower.includes("payroll") || lower.includes("nfp")) {
    return "jobs";
  }
  if (lower.includes("cpi") || lower.includes("pce") || lower.includes("ppi") || lower.includes("inflation")) return "inflation";
  if (lower.includes("fed") || lower.includes("rate") || lower.includes("fomc") || lower.includes("yield")) return "rates";
  return "growth";
}

function normalizeImportance(impact) {
  const lower = String(impact || "").toLowerCase();
  if (lower.includes("high")) return "high";
  if (lower.includes("medium") || lower.includes("med")) return "medium";
  return "low";
}

function impactDetails(importance) {
  if (importance === "high") {
    return {
      label: "High impact",
      folder: "Red folder",
      className: "impact-high",
    };
  }

  if (importance === "medium") {
    return {
      label: "Medium impact",
      folder: "Orange folder",
      className: "impact-medium",
    };
  }

  return {
    label: "Low impact",
    folder: "Yellow folder",
    className: "impact-low",
  };
}

function formatNewsTime(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return "Time not listed";

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function assetLogo(symbol) {
  const src =
    symbol === "BTCUSD"
      ? "https://s3-symbol-logo.tradingview.com/crypto/XTVCBTC.svg"
      : "https://s3-symbol-logo.tradingview.com/metal/gold.svg";
  return `<img class="asset-logo" src="${src}" alt="" />`;
}

function formatRelativeTime(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return "Time not listed";

  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];

  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds || unit === "minute") {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }

  return "just now";
}

function formatCountdown(ms) {
  if (ms <= 0) return "Now";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getUpcomingEvents(limit = events.length) {
  const now = Date.now();
  return events
    .filter((event) => {
      const eventTime = new Date(event.date).getTime();
      return Number.isFinite(eventTime) && eventTime >= now;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, limit);
}

function applyActiveView(view) {
  activeView = view;
  localStorage.setItem("usd-news-active-view", view);
  els.showNews.classList.toggle("active", view === "news");
  els.showTweets.classList.toggle("active", view === "tweets");
  els.showHeatmap.classList.toggle("active", view === "heatmap");

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === view);
  });

  if (view === "tweets") loadXTimeline();
  if (window.lucide) lucide.createIcons();
}

function applyFolderFilter(filter) {
  folderFilter = filter;
  localStorage.setItem("usd-news-folder-filter", filter);
  els.folderFilterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.folderFilter === filter);
  });
  render();
}

function createTradingViewWidget(container, symbol, theme) {
  container.innerHTML = "";
  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js";
  script.async = true;
  script.textContent = JSON.stringify({
    symbol,
    locale: "en",
    width: "100%",
    height: 126,
    colorTheme: theme,
    isTransparent: true,
  });
  container.append(widget, script);
}

function formatPrice(value, symbol) {
  const maximumFractionDigits = symbol === "BTCUSD" ? 0 : 2;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

function renderLiquidityMap(container, market) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "liquidity-price";
  header.innerHTML = `
    <span>Current ${escapeHtml(market.symbol)}</span>
    <strong>${formatPrice(market.price, market.symbol)}</strong>
  `;
  container.appendChild(header);

  for (const zone of market.zones) {
    const row = document.createElement("div");
    row.className = `liquidity-zone ${zone.distancePct >= 0 ? "above" : "below"}`;
    row.style.setProperty("--zone-strength", `${Math.min(100, Math.max(12, zone.intensity))}%`);
    row.innerHTML = `
      <div>
        <strong>${formatPrice(zone.level, market.symbol)}</strong>
        <span>${escapeHtml(zone.side)}</span>
      </div>
      <small>${zone.distancePct > 0 ? "+" : ""}${zone.distancePct.toFixed(2)}%</small>
    `;
    container.appendChild(row);
  }
}

function renderZonesPayload(payload) {
  const markets = payload?.markets || [];
  const btc = markets.find((market) => market.symbol === "BTCUSD");
  const xau = markets.find((market) => market.symbol === "XAUUSD");
  const sourceLabel = payload.source === "cache" ? "cached" : payload.source === "stale-cache" ? "backup" : "live";
  const updated = payload.updatedAt ? new Date(payload.updatedAt).toLocaleTimeString() : new Date().toLocaleTimeString();

  if (btc) {
    renderLiquidityMap(els.btcZones, btc);
    els.btcZonesStatus.textContent = `Major liquidity zones, ${sourceLabel} ${updated}.`;
  }

  if (xau) {
    renderLiquidityMap(els.xauZones, xau);
    els.xauZonesStatus.textContent = `Major liquidity zones, ${sourceLabel} ${updated}.`;
  }
}

async function fetchMarketZones() {
  els.refreshZones.disabled = true;
  els.btcZonesStatus.textContent = "Loading BTC liquidity zones...";
  els.xauZonesStatus.textContent = "Loading XAU liquidity zones...";

  try {
    const response = await fetch(`${marketZonesFeed}?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    localStorage.setItem(zonesCacheKey, JSON.stringify(payload));
    renderZonesPayload(payload);
  } catch (error) {
    const cachedPayload = JSON.parse(localStorage.getItem(zonesCacheKey) || "null");
    if (cachedPayload) {
      renderZonesPayload({ ...cachedPayload, source: "stale-cache" });
    } else {
      els.btcZones.innerHTML = '<div class="empty-state">Could not load BTC liquidity zones.</div>';
      els.xauZones.innerHTML = '<div class="empty-state">Could not load XAU liquidity zones.</div>';
      els.btcZonesStatus.textContent = "Zone feed unavailable.";
      els.xauZonesStatus.textContent = "Zone feed unavailable.";
    }
  } finally {
    els.refreshZones.disabled = false;
  }
}

function renderTradingViewWidgets(theme = document.documentElement.dataset.theme || "dark") {
  createTradingViewWidget(els.xauWidget, "OANDA:XAUUSD", theme);
  createTradingViewWidget(els.btcWidget, "BITSTAMP:BTCUSD", theme);
}

function classifyEvent(event) {
  const comparisonBase = toNumber(event.actual) ?? toNumber(event.forecast);
  const previous = toNumber(event.previous);
  if (comparisonBase == null || previous == null) {
    return {
      score: 0,
      label: "Neutral",
      className: "neutral-text",
      xau: "Wait",
      btc: "Wait",
      reason: "No clean forecast/previous comparison.",
    };
  }

  const rawDelta = comparisonBase - previous;
  const usefulDelta = inverseGoodForUsd.has(event.type) ? -rawDelta : rawDelta;
  const threshold = Math.max(Math.abs(previous) * 0.08, 0.01);
  const weight = weights[event.importance] ?? 1;

  if (Math.abs(usefulDelta) < threshold) {
    return {
      score: 0,
      label: "USD neutral",
      className: "neutral-text",
      xau: "Neutral",
      btc: "Neutral",
      reason: "Forecast is close to previous, so reaction may need actual data.",
    };
  }

  if (usefulDelta > 0) {
    return {
      score: weight,
      label: "USD bullish",
      className: "up-text",
      xau: "Bearish",
      btc: "Bearish",
      reason: "Stronger USD data can pressure gold and crypto through higher dollar/yield expectations.",
    };
  }

  return {
    score: -weight,
    label: "USD bearish",
    className: "down-text",
    xau: "Bullish",
    btc: "Bullish",
    reason: "Softer USD data can support gold and crypto if yields and dollar strength cool.",
  };
}

function getMarketRead(score) {
  if (score >= 5) {
    return {
      label: "Strong USD bullish impact",
      xauSignal: "Bearish",
      xauMove: "XAUUSD downside pressure",
      xauReason: "The news mix favors a stronger dollar, which can weigh on gold.",
      btcSignal: "Bearish",
      btcMove: "BTCUSD risk-off pressure",
      btcReason: "A stronger dollar can reduce liquidity appetite and pressure crypto.",
    };
  }

  if (score > 0) {
    return {
      label: "Mild USD bullish impact",
      xauSignal: "Caution",
      xauMove: "XAUUSD may fade rallies",
      xauReason: "Dollar-positive news can limit gold upside until the actual releases confirm.",
      btcSignal: "Caution",
      btcMove: "BTCUSD may chop lower",
      btcReason: "BTC may hesitate if markets price tighter liquidity.",
    };
  }

  if (score <= -5) {
    return {
      label: "Strong USD bearish impact",
      xauSignal: "Bullish",
      xauMove: "XAUUSD upside pressure",
      xauReason: "The news mix points to softer dollar expectations, often supportive for gold.",
      btcSignal: "Bullish",
      btcMove: "BTCUSD liquidity tailwind",
      btcReason: "Softer USD data can help risk assets when rate expectations ease.",
    };
  }

  if (score < 0) {
    return {
      label: "Mild USD bearish impact",
      xauSignal: "Caution",
      xauMove: "XAUUSD may catch bids",
      xauReason: "Gold may benefit if the dollar softens, but the signal is not strong.",
      btcSignal: "Caution",
      btcMove: "BTCUSD may firm",
      btcReason: "BTC can firm when USD pressure eases, but confirmation matters.",
    };
  }

  return {
    label: "Balanced USD impact",
    xauSignal: "Neutral",
    xauMove: "XAUUSD waiting for a catalyst",
    xauReason: "Current forecast and previous values do not point to a clear dollar move.",
    btcSignal: "Neutral",
    btcMove: "BTCUSD waiting for confirmation",
    btcReason: "The news set is balanced, so actual data will matter more than forecast.",
  };
}

function setSignal(el, text) {
  el.textContent = text;
  el.className = `signal ${text.toLowerCase()}`;
  if (text === "Neutral") el.className = "signal neutral";
  if (text === "Caution") el.className = "signal caution";
}

function renderCountdownAlert(upcomingEvents) {
  const urgent = upcomingEvents.filter((event) => {
    const ms = new Date(event.date).getTime() - Date.now();
    return ms >= 0 && ms <= 60 * 60 * 1000;
  });

  if (!urgent.length) {
    els.countdownAlert.className = "countdown-alert";
    els.countdownAlert.textContent = "No news inside 1 hour";
    return;
  }

  const next = urgent[0];
  const ms = new Date(next.date).getTime() - Date.now();
  els.countdownAlert.className = "countdown-alert hot";
  els.countdownAlert.innerHTML = `
    <span data-lucide="timer"></span>
    ${formatCountdown(ms)} to ${escapeHtml(next.name)}
  `;
}

function render() {
  els.newsList.innerHTML = "";

  let score = 0;
  for (const event of events) {
    score += classifyEvent(event).score;
  }

  const market = getMarketRead(score);
  const now = Date.now();
  const visibleEvents = events.filter((event) => {
    const eventTime = new Date(event.date).getTime();
    if (folderFilter !== "all" && event.importance !== folderFilter) return false;
    if (Number.isNaN(eventTime)) return newsView === "upcoming";
    return newsView === "past" ? eventTime < now : eventTime >= now;
  });

  els.folderFilterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.folderFilter === folderFilter);
  });
  els.upcomingNews.classList.toggle("active", newsView === "upcoming");
  els.pastNews.classList.toggle("active", newsView === "past");
  els.eventCount.textContent = `${visibleEvents.length} ${newsView} event${visibleEvents.length === 1 ? "" : "s"}`;
  els.headline.textContent = events.length ? market.label : "No USD news loaded";
  els.biasLabel.textContent = events.length ? `USD score ${score}` : "Refresh to load Forex Factory data";
  els.usdMeter.style.left = `${Math.max(5, Math.min(95, 50 + score * 7))}%`;

  setSignal(els.xauSignal, events.length ? market.xauSignal : "Neutral");
  els.xauMove.textContent = events.length ? market.xauMove : "Waiting for USD bias";
  els.xauReason.textContent = market.xauReason;

  setSignal(els.btcSignal, events.length ? market.btcSignal : "Neutral");
  els.btcMove.textContent = events.length ? market.btcMove : "Waiting for USD bias";
  els.btcReason.textContent = market.btcReason;
  renderCountdownAlert(getUpcomingEvents());

  for (const event of visibleEvents) {
    const read = classifyEvent(event);
    const impact = impactDetails(event.importance);
    const msUntilEvent = new Date(event.date).getTime() - Date.now();
    const countdownBadge = msUntilEvent >= 0 && msUntilEvent <= 60 * 60 * 1000
      ? `<span class="countdown-badge"><span data-lucide="timer"></span>${formatCountdown(msUntilEvent)}</span>`
      : "";
    const card = document.createElement("article");
    card.className = `news-card ${impact.className}`;
    card.innerHTML = `
      <div class="news-time">
        <span>Time</span>
        ${formatNewsTime(event.date)}
        ${countdownBadge}
      </div>
      <div class="news-main">
        <div class="title-row">
          <h3>${escapeHtml(event.name)}</h3>
          <span class="folder-badge ${impact.className}">
            <span data-lucide="folder"></span>
            ${impact.label}
          </span>
        </div>
        <div class="numbers">
          <span>Forecast <strong>${escapeHtml(event.forecast)}</strong></span>
          <span>Previous <strong>${escapeHtml(event.previous)}</strong></span>
          ${event.actual ? `<span>Actual <strong>${escapeHtml(event.actual)}</strong></span>` : ""}
        </div>
        <p>${read.reason}</p>
      </div>
      <div class="impact-read">
        <span class="${read.className}">${read.label}</span>
        <small>${assetLogo("XAUUSD")} XAUUSD: ${read.xau}</small>
        <small>${assetLogo("BTCUSD")} BTCUSD: ${read.btc}</small>
      </div>
    `;
    els.newsList.appendChild(card);
  }

  if (!visibleEvents.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = events.length ? `No ${newsView} USD events in the loaded feed.` : "No USD events loaded yet.";
    els.newsList.appendChild(empty);
  }

  if (window.lucide) lucide.createIcons();
}

function renderTruthPosts() {
  els.truthList.innerHTML = "";

  if (!truthPosts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Recent Truth Social posts could not be loaded.";
    els.truthList.appendChild(empty);
    return;
  }

  for (const post of truthPosts.slice(0, 5)) {
    const card = document.createElement("article");
    card.className = "truth-card";
    card.innerHTML = `
      <div class="truth-card-top">
        <span>@realDonaldTrump</span>
        <time datetime="${escapeHtml(post.publishedAt)}">${formatRelativeTime(post.publishedAt)}</time>
      </div>
      <p>${escapeHtml(post.text)}</p>
      <a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer">Read post</a>
    `;
    els.truthList.appendChild(card);
  }

  if (window.lucide) lucide.createIcons();
}

function loadXTimeline() {
  if (window.twttr?.widgets?.load) {
    window.twttr.widgets.load();
  }

  setTimeout(() => {
    const hasTimeline = document.querySelector(".x-embed iframe");
    els.xEmbedNotice.textContent = hasTimeline
      ? "Official X embed attempted. If it stays blank, X is blocking it in this browser."
      : "X is not returning the embedded timeline here. Use the X link above if the timeline stays blank.";
  }, 3500);
}

async function fetchForexFactory() {
  els.feedStatus.textContent = "Loading USD news from Forex Factory...";
  els.refreshNews.disabled = true;

  try {
    const response = await fetch(`${forexFactoryFeed}?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload.rows;
    const usdRows = rows
      .filter((row) => row.country === "USD" && row.forecast && row.previous)
      .map((row) => ({
        name: row.title,
        date: row.date,
        forecast: row.forecast,
        previous: row.previous,
        actual: row.actual || "",
        importance: normalizeImportance(row.impact),
        type: inferType(row.title),
      }))
      .sort((a, b) => {
        const impactDelta = (weights[b.importance] ?? 1) - (weights[a.importance] ?? 1);
        if (impactDelta !== 0) return impactDelta;
        return new Date(a.date) - new Date(b.date);
      });

    events.length = 0;
    events.push(...usdRows);
    localStorage.setItem(localCacheKey, JSON.stringify(usdRows));
    render();
    const source = Array.isArray(payload) ? "live" : payload.source;
    const sourceLabel = source === "live" ? "live feed" : source === "cache" ? "cached feed" : source === "stale-cache" ? "backup feed" : "backup file";
    els.feedStatus.textContent = `News synced ${new Date().toLocaleTimeString()} (${sourceLabel}).`;
  } catch (error) {
    const cachedRows = JSON.parse(localStorage.getItem(localCacheKey) || "[]");
    if (cachedRows.length) {
      events.length = 0;
      events.push(...cachedRows);
    }
    render();
    els.feedStatus.textContent = cachedRows.length
      ? "Refresh failed, so the last loaded news is still shown."
      : "Could not load Forex Factory news. Wait a few minutes and refresh again.";
  } finally {
    els.refreshNews.disabled = false;
  }
}

async function fetchTrumpTruth() {
  els.truthStatus.textContent = "Loading recent Truth Social posts...";
  els.refreshSocial.disabled = true;

  try {
    const response = await fetch(`${trumpTruthFeed}?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const posts = payload.posts || [];
    truthPosts.length = 0;
    truthPosts.push(...posts);
    localStorage.setItem(truthCacheKey, JSON.stringify(posts));
    renderTruthPosts();

    const sourceLabel = payload.source === "cache" ? "saved cache" : payload.source === "stale-cache" ? "saved backup cache" : "Trump's Truth RSS mirror";
    els.truthStatus.textContent = `Updated ${new Date().toLocaleTimeString()} from ${sourceLabel}.`;
  } catch (error) {
    const cachedPosts = JSON.parse(localStorage.getItem(truthCacheKey) || "[]");
    truthPosts.length = 0;
    truthPosts.push(...cachedPosts);
    renderTruthPosts();
    els.truthStatus.textContent = cachedPosts.length
      ? "Refresh failed, so the last loaded Truth Social posts are still shown."
      : "Could not load recent Truth Social posts.";
  } finally {
    els.refreshSocial.disabled = false;
  }
}

els.refreshNews.addEventListener("click", fetchForexFactory);
els.refreshSocial.addEventListener("click", fetchTrumpTruth);
els.refreshZones.addEventListener("click", fetchMarketZones);
els.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
});
els.time12.addEventListener("click", () => applyTimeFormat("12"));
els.time24.addEventListener("click", () => applyTimeFormat("24"));
els.showNews.addEventListener("click", () => applyActiveView("news"));
els.showTweets.addEventListener("click", () => applyActiveView("tweets"));
els.showHeatmap.addEventListener("click", () => applyActiveView("heatmap"));
els.folderFilterButtons.forEach((button) => {
  button.addEventListener("click", () => applyFolderFilter(button.dataset.folderFilter));
});
els.upcomingNews.addEventListener("click", () => {
  newsView = "upcoming";
  localStorage.setItem("usd-news-calendar-view", newsView);
  render();
});
els.pastNews.addEventListener("click", () => {
  newsView = "past";
  localStorage.setItem("usd-news-calendar-view", newsView);
  render();
});

els.timezoneNote.textContent = `Times shown in ${detectedTimezone}.`;
applyTheme(savedTheme);
applyTimeFormat(timeFormat);
applyActiveView(activeView);
render();
fetchForexFactory();
fetchTrumpTruth();
fetchMarketZones();
loadXTimeline();
window.addEventListener("load", loadXTimeline);
setInterval(render, 1000);
if (window.lucide) lucide.createIcons();
