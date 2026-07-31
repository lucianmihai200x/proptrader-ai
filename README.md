# PropTrader AI v18.6 — SMC predictiv M5–H4 pentru US30, NAS100, XAUUSD, GER40 și USOIL

Aplicația primește lumânări M5 închise din TradingView, construiește automat M15, M30, H1, H4 și contextul D1 și caută intrări SMC pe toate intervalele M5–H4. O intrare nu este mutată artificial la prețul curent.

Instrumentele configurate integral sunt `US30`, `NAS100`, `XAUUSD`, `GER40` și `USOIL`: colectare TradingView, planuri SMC, reanalizare până la TP/SL, Telegram, știri, istoric Dukascopy și backtest. Pentru fiecare instrument trebuie creată propria alertă a colectorului pe graficul M5.

Motorul separă două momente:

1. **PLAN SMC / PENDING** — este identificat un order block și sunt calculate Entry, SL, TP1, TP2 și TP3. Mesajul spune explicit să nu intri la prețul curent.
2. **SEMNAL LIVE** — este trimis separat numai dacă prețul revine la intrarea planificată fără să invalideze SL și o lumânare M5 respinge zona în direcția planului.

## Reguli SMC implementate

SMC nu are o specificație tehnică universală. În v18.6 regulile sunt explicite și testabile:

- swing high/low este confirmat numai după două lumânări în dreapta;
- structura bullish cere HH + HL, iar structura bearish LH + LL; EMA20/EMA50 este doar fallback;
- BOS/CHOCH cere închidere dincolo de un swing deja confirmat;
- lumânarea de rupere trebuie să aibă displacement măsurat în ATR;
- order block este ultima lumânare opusă înainte de displacement;
- setup-ul cere FVG sau sweep de lichiditate;
- SELL este acceptat numai în premium, iar BUY numai în discount; planurile nealiniate rămân observații fără Telegram;
- zonele invalidate sau testate de prea multe ori sunt eliminate;
- într-un plan de retragere, prețul poate fi deja dincolo de TP1 înainte să revină la Entry; țintele devin active numai după confirmarea intrării;
- dacă aceeași lumânare traversează Entry și SL, planul este anulat conservator deoarece ordinea intrabar nu poate fi demonstrată;
- D1 și H4 dau biasul de context, iar M5/M15/M30/H1/H4 pot produce planul;
- intrarea este mijlocul corpului order block-ului, SL trece de wick cu buffer ATR;
- TP1, TP2 și TP3 pornesc de la minimum 1,5R, 2,5R și 4R, pot folosi pool-uri de lichiditate valide și sunt forțate să rămână strict ordonate, cu minimum 0,35R între două ținte.

Motorul nu forțează un setup dacă aceste condiții nu există.

## Căutarea pe intervale mai mari

`ANALYSIS_TIMEFRAMES=5,15,30,60,240` activează independent M5, M15, M30, H1 și H4. Dacă M5 nu oferă structură validă, analiza continuă pe intervalele superioare. D1 (`1440`) este context, nu interval de semnal.

Dintr-o singură alertă M5, serverul produce lumânările superioare numai la închiderea completă a intervalului. Nu este nevoie de cinci alerte TradingView.

## Învățare din rezultate

Fiecare plan salvează configurația care l-a produs: instrument, direcție, interval, BOS/CHOCH, FVG, sweep și bias D1/H4. La atingerea Entry, serverul recalculează structura locală, H4/D1, riscul de știri, scorul adaptiv și istoricul modelului. O deteriorare mută planul direct în `CANCELLED`, fără Telegram LIVE. După activare:

- aplicația urmărește SL și cele trei ținte din lumânările M5;
- fiecare lumânare M5 actualizează starea tranzacției, progresul în R și etapa Entry/TP1/TP2;
- câte o treime din poziție este contabilizată la TP1, TP2 și TP3;
- după TP1, restul este protejat la break-even;
- rezultatul în R intră în jurnalul modelului;
- observațiile recente au pondere mai mare;
- scorul viitoarelor planuri similare este ajustat cu maximum ±12 puncte;
- după un SL sunt salvate condițiile observabile; un factor repetat în cel puțin trei pierderi similare aplică o penalizare suplimentară limitată la 4 puncte;
- după minimum 8 rezultate, un model cu limită statistică slabă sau medie ponderată negativă este blocat.

Primele rezultate sunt tratate ca perioadă de învățare, nu ca dovadă de validare. Învățarea adaptează scorurile; nu modifică singură regulile structurale și nu garantează profit.

## Notificări Telegram

Există două tipuri de mesaje:

- `🗺️ PLAN SMC — INTRARE ÎN AȘTEPTARE`, implicit pentru scor adaptiv ≥ 78;
- `🚨 PropTrader AI BUY/SELL`, după retest și confirmare M5.

Ambele includ intervalul, Entry, SL, TP1–TP3, biasul și starea validării istorice. Pentru SMC, pragul specializat de notificare este `SMC_NOTIFY_PENDING_SCORE`; celelalte semnale folosesc `TELEGRAM_MIN_SCORE`.

Fiecare mesaj LIVE indică explicit sursa: `SMC LIVE`, `MODEL ISTORIC`, `WEBHOOK` sau `TEST`. Planurile omise sunt salvate în jurnalul Telegram cu motivul concret: scor sub prag, mod WATCH, risc de știri sau Telegram neconfigurat.

## Aliasuri de instrument

Serverul salvează automat denumirile de broker sub un simbol unic:

- `US100`, `USTEC`, `USTECH`, `NDX` și `NASDAQ100` devin `NAS100`;
- `DJ30`, `DOW30`, `DJI` și `DJIA` devin `US30`;
- `GOLD` și `GOLDUSD` devin `XAUUSD`.
- `DE40`, `DAX`, `DAX40`, `GER30`, `DE30` și `GERMANY40` devin `GER40`;
- `WTI`, `XTIUSD`, `WTICOUSD`, `USCRUDE`, `OIL_CRUDE` și `LIGHT.CMD/USD` devin `USOIL`.

Astfel, lumânările TradingView, istoricul Dukascopy, știrile și rezultatele învățate nu mai sunt împărțite între denumiri diferite.

## Actualizare pe Render

1. Înlocuiește în GitHub fișierele proiectului cu cele din această arhivă.
2. Fă un commit și alege în Render **Manual Deploy → Deploy latest commit**.
3. Verifică `/health`: `version` trebuie să fie `18.6.0`.
4. În pagina **Istoric & Backtest**, după ce există minimum 3.000 de lumânări M5 din cel puțin 30 de zile, apasă **Reconstruiește M15 · M30 · H1 · H4 · D1 din M5**.

Variabile recomandate:

```text
ANALYSIS_TIMEFRAME=15
ANALYSIS_TIMEFRAMES=5,15,30,60,240
SMC_ENABLED=true
SMC_MIN_SCORE=68
SMC_NOTIFY_PENDING_SCORE=78
SMC_REQUIRE_M5_CONFIRMATION=true
SMC_MAX_PENDING_PER_SYMBOL=15
SMC_MIN_BLOCK_SAMPLES=8
SMC_OVERLAP_THRESHOLD=0.5
BACKTEST_MIN_TRADING_DAYS=60
AUTO_TRACK_TRADES=true
LIVE_MIN_ADAPTIVE_SCORE=72
TELEGRAM_ENABLED=true
TELEGRAM_MIN_SCORE=85
OFFICIAL_NEWS_ENABLED=true
NEWS_COUNTRIES=US,DE,GERMANY,EU,EA,EURO AREA
FMP_ENABLED=false
NEWS_CALENDAR_UNAVAILABLE_RISK=35
```

Păstrează valorile existente pentru `WEBHOOK_KEY`, `ADMIN_KEY`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN` și `TELEGRAM_CHAT_ID`. Nu publica secretele în GitHub.

Migrarea bazei de date este automată la pornire. v18.6:

- separă implicit statisticile și validarea SMC de Legacy și Modele istorice;
- păstrează distinct stările WATCH, eligibil LIVE și Telegram trimis;
- aplică circuit breaker separat pe familie de motor și instrument;
- marchează BUY în PREMIUM și SELL în DISCOUNT drept observații neacționabile;
- retrage planurile PENDING suprapuse, păstrând zona cu scorul cel mai bun;
- rulează reconstruirea intervalelor în fundal și refuză înlocuirea dacă istoricul M5 este insuficient;
- cere minimum 60 de zile pentru un backtest raportat drept relevant.
- adaugă GER40 și USOIL în normalizarea brokerilor și în descărcarea istorică Dukascopy (`deuidxeur`, respectiv `lightcmdusd`).

## TradingView — colector și indicator vizual

Arhiva conține două scripturi Pine cu roluri separate:

1. `PropTrader_AI_v17_M5_H4_Collector.pine` trimite lumânările M5 către server. Dacă alerta existentă funcționează numai prin Webhook URL, nu trebuie recreată.
2. `PropTrader_AI_v18_6_SMC_Visual.pine` analizează local datele TradingView și desenează pe grafic:
   - zona order block pentru intrare;
   - linia Entry;
   - SL;
   - TP1, TP2 și TP3;
   - direcția BUY/SELL, intervalul, BOS/CHOCH, starea PENDING/LIVE/WATCH și scorul SMC;
   - eligibilitatea informativă pentru pragul Telegram de 78;
   - progresul LIVE către TP1, TP2 și TP3;
   - biasul D1 și H4 într-un panou.

Indicatorul vizual verifică M5, M15, M30, H1 și H4 și, implicit, afișează planul activ cu scorul cel mai mare. Din setări poți forța afișarea unui singur interval.

### Instalarea indicatorului vizual

1. Deschide același instrument pe graficul de **5 minute**.
2. În Pine Editor creează un indicator nou.
3. Copiază integral conținutul fișierului `PropTrader_AI_v18_6_SMC_Visual.pine`.
4. Apasă **Save**, apoi **Add to chart**.
5. Lasă `Interval afișat = AUTO — cel mai bun`.
6. Nu crea alertă pentru acest indicator. El nu conține `alertcondition()` și este numai pentru desenarea nivelurilor.

Zona verde indică un plan BUY, iar zona roșie un plan SELL. Nivelurile sunt extinse spre dreapta. Pe grafic rămân exclusiv planurile `PENDING` și intrările `LIVE` care nu au ajuns încă la TP3 sau SL. Un plan PENDING rămâne desenat chiar dacă prețul se află deja dincolo de TP1, deoarece acesta așteaptă retragerea în order block; TP-urile sunt urmărite numai după activare. Planurile expirate sau invalidate sunt șterse imediat; nu mai există starea gri „ULTIMUL PLAN”. Eticheta BUY/SELL apare numai după atingerea Entry și respingere confirmată M5; sub pragul informativ Telegram apare `WATCH`.

### Limită tehnică importantă

Webhook-ul TradingView este un flux într-un singur sens: TradingView trimite lumânările către server, dar Pine nu poate citi direct răspunsul aplicației. Din acest motiv, indicatorul vizual reproduce local regulile structurale SMC, însă nu poate importa scorul adaptiv, filtrul de știri și rezultatele învățate de server.

Pot exista mici diferențe între nivelurile desenate și mesajul Telegram din cauza feed-ului de preț, momentului de închidere și filtrelor adaptive. Pentru intrarea efectivă, mesajul Telegram al serverului rămâne reperul principal.

### Alerta colectorului

Pe graficul de 5 minute:

- condiția alertei rămâne **Colector M5 — webhook fără notificări**;
- frecvența rămâne **Once Per Bar Close**;
- la notificări păstrează bifat numai **Webhook URL**;
- debifează notificarea în aplicație, popup/toast, e-mail și sunet.

Repetă alerta colectorului pentru fiecare grafic pe care vrei analiză: US30, NAS100, XAUUSD, GER40 și USOIL. Un singur colector Pine nu poate trimite automat lumânările tuturor simbolurilor dacă este instalat doar pe un grafic.

Webhook:

```text
https://ADRESA-TA-RENDER/webhook?key=WEBHOOK_KEY
```

TradingView va înregistra tehnic un webhook la fiecare lumânare M5 deoarece acesta este fluxul de date. Nu trebuie să afișeze notificări utilizatorului pentru acele lumânări. Indicatorul vizual doar desenează; Telegram primește numai planurile și activările care trec filtrele serverului.

## Știri

FMP este oprit implicit. Dacă variabila a rămas activă, dar abonamentul răspunde HTTP 402, v18.6 oprește automat FMP pentru sesiunea serverului și continuă sincronizarea fluxurilor oficiale gratuite. Fluxurile Federal Reserve și BLS acoperă contextul SUA, ECB alimentează contextul GER40, iar EIA furnizează titluri energetice relevante pentru USOIL, toate fără chei API. Dacă nu există calendar anticipat, motorul aplică risc de siguranță în loc de risc zero.

Activează FMP numai dacă planul tău include endpoint-ul calendarului economic:

```text
FMP_ENABLED=true
FMP_API_KEY=cheia-ta
```

## Verificare locală

```bash
npm install
npm test
npm start
```

Aplicația folosește Node.js 20 sau mai nou. Rulează întâi în paper trading și validează separat fiecare instrument și interval pe date nevăzute și rezultate live suficiente.
