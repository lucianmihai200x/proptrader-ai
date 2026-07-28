PROPTRADER AI v2 — ACTUALIZARE

Înlocuiește în repository-ul GitHub fișierele:
- package.json
- server.js
- render.yaml
- folderul public

Adaugă:
- PropTrader_AI_v2_Signals.pine

După Commit changes, Render va face automat un nou deploy.

Funcții v2:
- BOS și CHOCH
- FVG
- liquidity sweep
- sesiuni London/New York
- scor compozit
- probabilitate estimată
- TP1, TP2, TP3
- filtre în dashboard
- buton pentru semnal demonstrativ
- Telegram opțional

Test:
1. În Render > Environment copiază ADMIN_KEY.
2. Deschide aplicația.
3. Introdu ADMIN_KEY.
4. Apasă „Creează semnal test”.

TradingView:
1. Copiază Pine Script-ul v2 în Pine Editor.
2. Add to chart.
3. Creează alerta cu Any alert() function call.
4. Folosește webhook:
https://ADRESA-TA.onrender.com/webhook?key=WEBHOOK_KEY

Notă:
Probabilitatea este o estimare euristică bazată pe confirmări tehnice, nu o garanție.
