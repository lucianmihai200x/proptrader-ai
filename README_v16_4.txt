PROPTRADER AI v16.4 — AUTO SIGNALS + MONITORIZARE

CE ESTE NOU
1. Serverul nu mai așteaptă exclusiv un SIGNAL din Pine. Fiecare BAR M15 este analizat, iar un model orar foarte puternic poate fi transformat automat în semnal BUY/SELL.
2. Semnalul automat cere implicit minimum 50 de observații, probabilitate istorică de minimum 75%, trend EMA confirmat, risc de știri acceptabil și scor calculat de minimum 85.
3. Semnalele automate folosesc protecția existentă: scor adaptiv, circuit breaker, duplicate și prag Telegram.
4. Este disponibil un test complet de semnal Telegram, fără a introduce tranzacția demonstrativă în jurnalul real.
5. Aplicația monitorizează webhook-ul și baza de date. Dacă BAR-urile lipsesc peste 35 de minute în timpul pieței sau baza de date cade, trimite o singură alertă Telegram și apoi mesaj de revenire.
6. Filtrul de știri nu mai consideră automat risc zero când toate sursele sunt indisponibile. Aplică un risc de siguranță configurabil, implicit 55/100.
7. Dashboard-ul afișează starea sistemului, pragurile semnalelor automate și avertismentele active.

DEPLOY
- Înlocuiește toate fișierele din GitHub cu cele din arhivă.
- Commit changes.
- Render > Manual Deploy > Deploy latest commit.
- Verifică /health: version trebuie să fie 16.4.0.

VARIABILE NOI RECOMANDATE
AUTO_PATTERN_SIGNALS=true
PATTERN_SIGNAL_MIN_SAMPLES=50
PATTERN_SIGNAL_MIN_PROBABILITY=75
PATTERN_SIGNAL_MIN_SCORE=85
WEBHOOK_STALE_MINUTES=35
SYSTEM_MONITOR_INTERVAL_MINUTES=5
TELEGRAM_SYSTEM_ALERTS=true
NEWS_UNAVAILABLE_RISK=55

TEST DUPĂ DEPLOY
1. În Administrare introdu ADMIN_KEY, US30, un preț apropiat de piață și BUY sau SELL.
2. Apasă „Test semnal complet”.
3. Primești în Telegram mesaj cu Entry, SL, TP1-TP3, scor și explicație.
4. Testul nu este salvat ca tranzacție reală.

IMPORTANT
Semnalele automate sunt estimări statistice, nu certitudini. Folosește paper trading până când backtestul M15 și rezultatele live confirmă expectancy pozitivă și drawdown acceptabil.
