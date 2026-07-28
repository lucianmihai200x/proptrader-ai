PROPTRADER AI v3 — MOTOR DE ANALIZĂ

Actualizare:
1. Dezarhivează.
2. În GitHub, în același repository, înlocuiește:
   - package.json
   - server.js
   - render.yaml
   - public/index.html
3. Adaugă PropTrader_AI_v3_Engine.pine.
4. Commit changes.
5. Render va redeploya automat.

Motor v3:
- analiză multi-timeframe
- EMA trend
- VWAP
- BOS / CHOCH
- FVG
- liquidity sweep
- Order Block aproximativ
- sesiuni London / New York
- scor ponderat
- prag minim configurabil
- TP1 / TP2 / TP3
- probabilitate euristică

Test:
1. Copiază ADMIN_KEY din Render > Environment.
2. Introdu cheia în dashboard.
3. Apasă Creează semnal test v3.

TradingView:
1. Deschide Pine Editor.
2. Copiază PropTrader_AI_v3_Engine.pine.
3. Save și Add to chart.
4. Creează alertă: Any alert() function call.
5. Webhook:
   https://ADRESA-TA.onrender.com/webhook?key=WEBHOOK_KEY

Recomandare inițială:
- US30 M5 cu timeframe superior M15
- XAUUSD M5 cu timeframe superior M15
- prag scor 80
- testează pe demo

Important:
Motorul este bazat pe reguli tehnice și scoruri euristice. Nu este încă un model ML antrenat și nu garantează profit.
