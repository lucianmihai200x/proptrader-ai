const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRssItems, fetchOfficialNews } = require("../news_feeds");

test("parseRssItems reads RSS and Atom entries", () => {
  const xml = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title><![CDATA[Federal Reserve issues FOMC statement]]></title>
        <description>Rates &amp; monetary policy</description>
        <link>https://example.test/fed</link>
        <guid>fed-1</guid>
        <pubDate>Wed, 29 Jul 2026 18:00:00 GMT</pubDate>
      </item>
    </channel></rss>
    <feed>
      <entry>
        <title>BLS employment update</title>
        <summary>Payroll data</summary>
        <link href="https://example.test/bls"/>
        <id>bls-1</id>
        <updated>2026-07-30T12:30:00Z</updated>
      </entry>
    </feed>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Federal Reserve issues FOMC statement");
  assert.equal(items[0].summary, "Rates & monetary policy");
  assert.equal(items[1].url, "https://example.test/bls");
});

test("fetchOfficialNews keeps working when one official feed fails", async () => {
  const feeds = [
    { id: "FED_TEST", source: "Federal Reserve", url: "https://example.test/ok" },
    { id: "BLS_TEST", source: "BLS", url: "https://example.test/fail" }
  ];
  const fetchImpl = async url => {
    if (url.endsWith("/fail")) return { ok: false, status: 503, text: async () => "" };
    return {
      ok: true,
      status: 200,
      text: async () => `<rss><channel><item><title>FOMC update</title><guid>x</guid><pubDate>Wed, 29 Jul 2026 18:00:00 GMT</pubDate></item></channel></rss>`
    };
  };
  const result = await fetchOfficialNews({ fetchImpl, feeds, timeoutMs: 1000 });
  assert.equal(result.successes, 1);
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].externalId, /^OFFICIAL-FED_TEST-/);
  assert.equal(result.feeds[1].ok, false);
});
