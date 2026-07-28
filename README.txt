PROPTRADER AI v1 — RENDER

Conținut:
- dashboard online
- webhook TradingView
- salvare semnale în PostgreSQL
- ștergere semnale cu ADMIN_KEY
- Telegram opțional
- indicator Pine Script

Publicare:
1. Creează un repository nou pe GitHub.
2. Încarcă toate fișierele din această arhivă, inclusiv folderul public.
3. În Render alege New + Blueprint.
4. Conectează repository-ul.
5. Render va detecta render.yaml și va crea aplicația și baza de date.
6. După deploy, deschide Environment și copiază WEBHOOK_KEY.

Webhook TradingView:
https://ADRESA-TA.onrender.com/webhook?key=WEBHOOK_KEY

TradingView:
1. Pine Editor.
2. Copiază codul din PropTrader_AI_v1_Signals.pine.
3. Save și Add to chart.
4. Creează alerta cu Any alert() function call.
5. Introdu URL-ul webhook.
6. Creează alerte separate pentru US30 și XAUUSD, pe timeframe-urile dorite.

Telegram opțional:
Adaugă în Render Environment:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Important:
Strategia actuală este tehnică, nu AI propriu-zis.
Scorul tehnic nu garantează profit.
Testează mai întâi pe cont demo.
