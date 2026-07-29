PROPTRADER AI v16.3 — M15 + BACKTEST INTEGRITY

CE S-A SCHIMBAT
1. Analiza TradingView rulează pe M15, după închiderea fiecărei lumânări.
2. Același script trimite automat BAR la fiecare 15 minute și SIGNAL numai când setup-ul trece filtrele.
3. Graficul nu afișează EMA/VWAP; rămân numai etichetele BUY/SELL cu Entry, SL, TP1 și scor.
4. Backtestul nu mai alege direcția TIME după mișcarea viitoare. Sunt testate separat BUY și SELL.
5. Intrarea backtestului este la open-ul lumânării următoare, nu retroactiv la close-ul lumânării de semnal.
6. Dacă SL și TP sunt atinse în aceeași lumânare, backtestul consideră conservator SL.
7. Profit Factor nu mai este înlocuit cu 99. Fără pierderi este raportat ca infinit și nu este suficient pentru clasificarea „Robust”.
8. Sunt incluse costurile, slippage-ul, drawdown-ul în R, segment final nevăzut, walk-forward ancorat și penalizare pentru testarea multor combinații.
9. Eroarea „rows.map is not a function” este tratată atât în API, cât și în interfață.
10. Poți construi M15 direct din istoricul M5 deja salvat.

DEPLOY
1. Înlocuiește toate fișierele din repository cu cele din arhivă.
2. Commit changes.
3. Render > Manual Deploy > Deploy latest commit.
4. Deschide /health și verifică version = 16.3.0 și analysisTimeframe = 15.
5. În Render Environment poți adăuga ANALYSIS_TIMEFRAME=15. Dacă lipsește, valoarea implicită este 15.

TRADINGVIEW
1. Șterge alerta veche de 30 minute.
2. Deschide Pine Editor și copiază integral PropTrader_AI_v16_3_M15_Signal_Engine.pine.
3. Save și Add to chart.
4. Schimbă graficul US30 pe 15 minute.
5. Create Alert:
   - Condition: PropTrader AI v16.3 — Motor selectiv M15
   - Any alert() function call
   - Webhook URL: https://proptrader-ai-v1.onrender.com/webhook?key=CHEIA_TA_WEBHOOK
   - Message: nu modifica mesajul; scriptul generează JSON automat.

ISTORIC M15
- În aplicație > Istoric & Backtest apasă „Construiește M15 din istoricul M5”.
- Aplicația folosește cele aproximativ 151.000 de lumânări M5 deja salvate și creează lumânări M15 complete.
- Apoi rulează backtestul cu Timeframe = 15.

SETĂRI INIȚIALE RECOMANDATE
TradingView:
- Scor minim: 86
- Cooldown: 4 lumânări M15
- SL: 1,25 ATR
- TP1: 1,5R; TP2: 2,5R; TP3: 3,5R

Backtest:
- Timeframe: 15
- Orizont: 3 lumânări
- Eșantion minim: 60
- Win rate minim train: 55%
- Cost: 2 bps
- Slippage: 0,5 bps
- SL: 1,2 ATR
- Țintă: 1,5R
- Walk-forward: 5 folduri

IMPORTANT
„Probability” din Pine este un scor euristic, nu o probabilitate demonstrată. Serverul decide LIVE/WATCH pe baza scorului adaptiv, știrilor, istoricului setup-ului și circuit breaker-ului. Testează în paper trading înainte de folosire pe un cont real sau funded.
