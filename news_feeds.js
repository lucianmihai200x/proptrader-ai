"use strict";

const crypto = require("node:crypto");

const OFFICIAL_NEWS_FEEDS = Object.freeze([
  Object.freeze({
    id: "FED_MONETARY",
    source: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_monetary.xml"
  }),
  Object.freeze({
    id: "BLS_LATEST",
    source: "U.S. Bureau of Labor Statistics",
    url: "https://www.bls.gov/feed/bls_latest.rss"
  })
]);

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripMarkup(value) {
  return decodeXml(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(block, names) {
  for (const name of names) {
    const match = String(block).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return stripMarkup(match[1]);
  }
  return "";
}

function linkValue(block) {
  const href = String(block).match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  if (href) return decodeXml(href[1]).trim();
  return tagValue(block, ["link"]);
}

function parseRssItems(xml) {
  const source = String(xml || "");
  const blocks = [
    ...(source.match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(source.match(/<entry\b[\s\S]*?<\/entry>/gi) || [])
  ];
  return blocks.map(block => {
    const title = tagValue(block, ["title"]);
    const summary = tagValue(block, ["description", "summary", "content", "content:encoded"]);
    const url = linkValue(block);
    const guid = tagValue(block, ["guid", "id"]) || url || title;
    const publishedRaw = tagValue(block, ["pubDate", "published", "updated", "dc:date"]);
    const published = new Date(publishedRaw);
    return {
      title,
      summary,
      url,
      guid,
      publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString()
    };
  }).filter(item => item.title);
}

function stableFeedId(feedId, item) {
  const key = `${feedId}|${item.guid}|${item.publishedAt}|${item.title}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

async function fetchOfficialNews({
  fetchImpl = global.fetch,
  feeds = OFFICIAL_NEWS_FEEDS,
  timeoutMs = 12000
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch nu este disponibil");
  const items = [];
  const feedResults = [];
  for (const feed of feeds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(feed.url, {
        headers: {
          accept: "application/rss+xml, application/xml, text/xml, */*",
          "user-agent": "PropTrader-AI/17.1"
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseRssItems(await response.text()).map(item => ({
        ...item,
        externalId: `OFFICIAL-${feed.id}-${stableFeedId(feed.id, item)}`,
        feedId: feed.id,
        source: feed.source
      }));
      items.push(...parsed);
      feedResults.push({ id: feed.id, source: feed.source, ok: true, received: parsed.length });
    } catch (error) {
      feedResults.push({ id: feed.id, source: feed.source, ok: false, received: 0, error: error.message });
    } finally {
      clearTimeout(timer);
    }
  }
  const successes = feedResults.filter(item => item.ok).length;
  if (!successes) {
    const details = feedResults.map(item => `${item.id}: ${item.error || "eroare"}`).join(" | ");
    throw new Error(`Fluxurile oficiale nu răspund: ${details}`);
  }
  const deduplicated = [...new Map(items.map(item => [item.externalId, item])).values()];
  if (!deduplicated.length) throw new Error("Fluxurile oficiale au răspuns fără articole parsabile.");
  return { items: deduplicated, feeds: feedResults, successes };
}

module.exports = {
  OFFICIAL_NEWS_FEEDS,
  decodeXml,
  stripMarkup,
  parseRssItems,
  stableFeedId,
  fetchOfficialNews
};
