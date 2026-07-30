# PropTrader AI v17.1 — M5 până la H4

Aplicația primește lumânări M5 închise din TradingView, construiește automat M15, M30, H1 și H4, analizează separat toate cele cinci intervale și trimite pe Telegram numai semnalele LIVE validate.

Notificarea Telegram conține:

- BUY sau SELL și instrumentul;
- intervalul care a produs semnalul;
- prețul de intrare;
- Stop Loss;
- TP1, TP2 și TP3, inclusiv distanța în R;
- scorul adaptiv, probabilitatea istorică și explicația deciziei.

## Ce s-a schimbat în v17.1

1. `ANALYSIS_TIMEFRAMES=5,15,30,60,240` activează M5, M15, M30, H1 și H4.
2. O singură alertă TradingView pe M5 alimentează toate intervalele.
3. Serverul agregă automat fiecare lumânare M5 nouă în intervalele superioare exact la închiderea lor.
4. Istoricul M5 poate fi transformat dintr-un singur click în M15, M30, H1 și H4.
5. Fiecare interval are propriul orizont, cooldown și prag minim.
6. Confirmarea EMA20/EMA50 de pe intervalul superior este folosită când există suficiente date.
7. Nivelurile Entry, SL și TP1–TP3 sunt validate înainte ca semnalul să poată fi salvat sau notificat.
8. Scorul nu mai este ridicat artificial până la pragul Telegram.
9. Mesajele Telegram afișează corect M5/M15/M30/H1/H4 și toate cele trei ținte.
10. FMP este oprit implicit, astfel încât o cheie fără acces la calendar nu mai produce eroarea HTTP 402.
11. Titlurile sunt sincronizate fără chei API din fluxurile oficiale Federal Reserve și BLS.
12. Colectorul TradingView folosește o condiție dedicată care poate fi configurată numai cu Webhook URL, fără popup, aplicație, e-mail sau sunet.

## Profilurile implicite

| Interval | Observații minime | Probabilitate minimă | Scor minim | Orizont | Cooldown |
| --- | ---: | ---: | ---: | ---: | ---: |
| M5 | 80 | 78% | 88 | 6 lumânări | 30 minute |
| M15 | 60 | 76% | 86 | 4 lumânări | 60 minute |
| M30 | 50 | 75% | 85 | 3 lumânări | 90 minute |
| H1 | 50 | 75% | 85 | 3 lumânări | 180 minute |
| H4 | 50 | 75% | 85 | 2 lumânări | 480 minute |

Pragurile globale existente rămân active și pot doar să facă filtrarea mai strictă.

## Actualizare pe Render

1. Înlocuiește în GitHub fișierele proiectului cu cele din această arhivă.
2. Fă un commit.
3. În Render alege **Manual Deploy → Deploy latest commit**.
4. Verifică adresa `/health`. Câmpul `version` trebuie să fie `17.1.0`, iar `analysisTimeframes` trebuie să conțină `5, 15, 30, 60, 240`.

Variabile importante:

```text
ANALYSIS_TIMEFRAME=15
ANALYSIS_TIMEFRAMES=5,15,30,60,240
AUTO_PATTERN_SIGNALS=true
PATTERN_SIGNAL_MIN_SAMPLES=50
PATTERN_SIGNAL_MIN_PROBABILITY=75
PATTERN_SIGNAL_MIN_SCORE=85
LIVE_MIN_ADAPTIVE_SCORE=72
TELEGRAM_ENABLED=true
TELEGRAM_MIN_SCORE=85
OFFICIAL_NEWS_ENABLED=true
FMP_ENABLED=false
NEWS_CALENDAR_UNAVAILABLE_RISK=35
```

Păstrează în Render valorile deja configurate pentru `WEBHOOK_KEY`, `ADMIN_KEY`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN` și `TELEGRAM_CHAT_ID`. Nu pune cheile în GitHub.

## Configurarea TradingView

TradingView salvează în alertă o copie a scriptului și a setărilor din momentul creării. De aceea alerta veche trebuie ștearsă și recreată după instalarea scriptului v17.1.

1. Deschide graficul instrumentului dorit pe **5 minute**.
2. Adaugă în Pine Editor fișierul `PropTrader_AI_v17_M5_H4_Collector.pine`.
3. Apasă **Add to chart**.
4. Șterge alerta veche care folosește **Any alert() function call**.
5. Creează o alertă nouă și alege condiția **Colector M5 — webhook fără notificări**.
6. Alege frecvența **Once Per Bar Close**.
7. La notificări păstrează bifat numai **Webhook URL**. Debifează notificarea în aplicație, popup/toast, e-mail și sunet.
8. La Webhook URL introdu:

```text
https://ADRESA-TA-RENDER/webhook?key=WEBHOOK_KEY
```

9. Lasă alerta activă. Indicatorul trimite numai lumânări M5 închise; serverul produce intervalele superioare.

Jurnalul tehnic al alertei va înregistra în continuare câte un webhook la închiderea fiecărei lumânări M5, deoarece serverul are nevoie de aceste date. Nu vei mai primi însă notificări vizibile TradingView. Numai setup-urile LIVE BUY/SELL validate sunt trimise pe Telegram, cu Entry, SL și TP1–TP3.

Pentru mai multe instrumente, creează câte o alertă M5 pe fiecare grafic. Instrumentele acceptate de descărcarea Dukascopy sunt US30, XAUUSD și NAS100.

## Știri și calendar economic

Implicit, aplicația folosește fluxurile oficiale Federal Reserve și U.S. Bureau of Labor Statistics, fără chei API. Acestea oferă titluri publicate, nu un calendar economic complet cu evenimente viitoare.

De aceea, când titlurile sunt recente dar calendarul anticipat lipsește, motorul aplică `NEWS_CALENDAR_UNAVAILABLE_RISK=35` în loc să presupună risc zero. Pentru un calendar anticipat poți activa FMP numai dacă abonamentul tău permite endpoint-ul:

```text
FMP_ENABLED=true
FMP_API_KEY=cheia-ta
```

Dacă planul nu include calendarul, lasă `FMP_ENABLED=false`; cheia poate rămâne în Render și nu va fi apelată.

## Pregătirea istoricului multi-timeframe

În pagina **Istoric & Backtest**:

1. selectează instrumentul;
2. descarcă istoricul M5;
3. apasă **Construiește M15 · M30 · H1 · H4 din M5**;
4. verifică seturile de date;
5. rulează separat backtestul pentru fiecare interval.

Semnalele statistice au nevoie de suficiente observații. Fără istoric, serverul colectează corect datele LIVE, dar nu forțează semnale premature.

## Test Telegram

În **Administrare** introdu `ADMIN_KEY`, instrumentul, prețul și intervalul, apoi:

- **Test conexiune** verifică botul;
- **Test semnal complet** trimite un mesaj demonstrativ cu Entry, SL și TP1–TP3;
- testul complet nu este introdus în jurnalul real.

## Verificare locală

```bash
npm install
npm test
npm start
```

Aplicația folosește Node.js 20 sau mai nou.

## Important

Semnalele sunt estimări statistice, nu certitudini și nu garantează profit. Folosește paper trading până când fiecare instrument și fiecare interval are un backtest pozitiv pe date nevăzute și rezultate LIVE suficiente.
