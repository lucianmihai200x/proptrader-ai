PROPTRADER AI v6 — STRUCTURĂ AVANSATĂ

Actualizare:
1. Dezarhivează arhiva.
2. În GitHub înlocuiește:
   - package.json
   - server.js
   - public/index.html
3. Adaugă:
   - PropTrader_AI_v6_Engine.pine
4. Commit changes și așteaptă redeploy-ul Render.

Funcții v6:
- HH / HL / LH / LL
- Equal Highs / Equal Lows
- Premium / Discount
- Fibonacci OTE 0.618–0.705
- Kill Zones
- fază de piață
- stare FVG
- stare Order Block
- explicația detaliată a scorului
- statistici pe faza pieței și premium/discount

Test:
1. Introdu ADMIN_KEY.
2. Apasă Creează semnal test v6.
3. Verifică blocul cu detalierea punctajului.

TradingView:
1. Copiază PropTrader_AI_v6_Engine.pine în Pine Editor.
2. Save și Add to chart.
3. Creează alerta cu Any alert() function call.
4. Webhook:
   https://ADRESA-TA.onrender.com/webhook?key=WEBHOOK_KEY

Configurație inițială:
- US30 M5, HTF M15
- XAUUSD M5, HTF M15
- Scor minim 85
- Kill Zone activă

Notă:
Motorul rămâne unul bazat pe reguli tehnice și scor euristic. Nu este un model ML validat.
