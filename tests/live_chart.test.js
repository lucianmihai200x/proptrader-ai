const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("v19.0 exposes recent chart candles and an SSE live stream", () => {
  assert.match(server, /app\.get\("\/api\/chart-data"/);
  assert.match(server, /app\.get\("\/api\/live-bars"/);
  assert.match(server, /Content-Type","text\/event-stream/);
  assert.match(server, /broadcastLiveChartBar\(bar\)/);
  assert.match(server, /for\(const higherBar of derived\)broadcastLiveChartBar\(higherBar\)/);
  assert.match(server, /heartbeatLiveChartClients/);
});

test("v19.0 serves TradingView Lightweight Charts locally", () => {
  assert.equal(pkg.dependencies["lightweight-charts"], "5.2.0");
  assert.match(server, /\/vendor\/lightweight-charts/);
  assert.match(html, /lightweight-charts\.standalone\.production\.js/);
  assert.match(html, /LightweightCharts\.createSeriesMarkers|L\.createSeriesMarkers/);
});

test("active signal cards open a responsive chart with all trade levels", () => {
  assert.match(html, /Grafic live/);
  assert.match(html, /openLiveChart/);
  assert.match(html, /liveChartTimeframe/);
  assert.match(html, /Entry/);
  assert.match(html, /Stop Loss/);
  assert.match(html, /TP1/);
  assert.match(html, /TP2/);
  assert.match(html, /TP3/);
  assert.match(html, /currentR/);
  assert.match(html, /Europe\/Bucharest/);
  assert.match(html, /@media\(max-width:900px\).*live-chart-modal/);
});

test("live chart stays transparent about webhook update frequency", () => {
  assert.match(html, /M5 se actualizează la închiderea fiecărei lumânări/);
  assert.match(html, /Ultima lumânare acum/);
  assert.match(server, /updateMode:"ON_BAR_CLOSE"/);
});
