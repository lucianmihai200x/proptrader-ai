PROPTRADER AI v4 — VERSIUNE FUNCȚIONALĂ

Flux:
TradingView -> webhook Render -> PostgreSQL -> dashboard -> rezultate TP/SL -> statistici

ACTUALIZARE
1. Dezarhivează arhiva.
2. În GitHub, înlocuiește:
   package.json
   server.js
   render.yaml
   public/index.html
3. Adaugă PropTrader_AI_v4_Engine.pine.
4. Commit changes.
5. Așteaptă redeploy-ul Render.

TEST DASHBOARD
1. Render > serviciu > Environment.
2. Copiază valoarea ADMIN_KEY.
3. Deschide aplicația.
4. Introdu ADMIN_KEY.
5. Apasă Creează semnal test.
6. Poți închide manual testul cu TP1/TP2/TP3/SL/BE.

TRADINGVIEW
1. Deschide Pine Editor.
2. Copiază PropTrader_AI_v4_Engine.pine.
3. Save și Add to chart.
4. Creează alerta cu Any alert() function call.
5. Webhook URL:
   https://ADRESA-TA.onrender.com/webhook?key=WEBHOOK_KEY
6. Creează alerte separate:
   US30 M5, HTF M15
   XAUUSD M5, HTF M15

REZULTATE AUTOMATE
Scriptul trimite un eveniment SIGNAL la intrare.
Când prețul atinge SL sau TP, trimite un eveniment CLOSE.
Dashboard-ul calculează:
- Win rate
- Total R
- Profit factor
- semnale deschise/închise
- scor și probabilitate medie

TELEGRAM OPȚIONAL
În Render Environment adaugă:
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID

LIMITARE IMPORTANTĂ
TradingView urmărește rezultatul numai cât timp alerta este activă.
Pe aceeași alertă/script este urmărit un singur semnal activ.
Probabilitatea este euristică, nu predicție garantată și nu model ML validat.
Testează minimum câteva săptămâni pe demo înainte de cont finanțat.
