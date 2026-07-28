PROPTRADER AI v16 — ANALIZĂ AUTOMATĂ TRADINGVIEW LA 30 MINUTE

IMPORTANT
- Motorul analizează fiecare lumânare de 30 minute DUPĂ închidere.
- Nu trimite obligatoriu BUY/SELL la fiecare 30 minute. Trimite alertă numai când condițiile ating scorul minim.
- SL și TP sunt calculate din ATR și raportul R configurat.

INSTALARE APLICAȚIE
1. Înlocuiește fișierele din GitHub cu cele din această arhivă.
2. Commit, apoi Render > Manual Deploy > Deploy latest commit.
3. Verifică /health: versiunea trebuie să fie 16.0.0.

INSTALARE TRADINGVIEW
1. Deschide Pine Editor.
2. Copiază integral PropTrader_AI_v16_30m_Signal_Engine.pine.
3. Save și Add to chart.
4. Schimbă graficul US30 pe 30m. Scriptul afișează avertisment dacă timeframe-ul nu este 30m.
5. Șterge alerta veche v8.0.2.
6. Creează o alertă nouă:
   Condition: PropTrader AI v16 — Analiză automată 30m
   Opțiune: Any alert() function call
   Webhook URL: https://proptrader-ai-v1.onrender.com/webhook?key=CHEIA_TA_WEBHOOK
   Expiration: cât mai lungă
7. Nu modifica Message. JSON-ul este generat de alert() din script.

VERIFICARE
După primul semnal, /health va afișa lastWebhookAt și lastWebhookResult.
În Render Logs va apărea o linie [WEBHOOK] primit și apoi ACCEPTAT BUY/SELL.
Semnalul apare în fila Active din aplicație cu Entry, SL, TP1, TP2 și TP3.

SETĂRI INIȚIALE RECOMANDATE US30
- Grafic: 30m
- Scor minim: 72
- Pauză între semnale: 2 lumânări
- SL: 1.35 ATR
- TP1: 1.5R
- TP2: 2.5R
- TP3: 3.5R

Rezultatele istorice și scorurile nu garantează rezultate viitoare. Testează mai întâi în paper trading.
