# PropTrader AI v19.0.1 — SMC predictiv M5–H4, Telegram și execuție automată Capital.com

Aplicația primește lumânări M5 închise din TradingView, construiește automat M15, M30, H1, H4 și contextul D1 și caută intrări SMC pe toate intervalele M5–H4. O intrare nu este mutată artificial la prețul curent.

v19.0 poate transmite automat către Capital.com numai semnalele `SMC LIVE` care au atins Entry, au confirmare M5 și au trecut din nou filtrele de scor, știri, structură și expunere. Funcția este oprită implicit și pornește în mediul `DEMO`.

## Execuție automată Capital.com

Fluxul este `TradingView → PropTrader AI → reverificare SMC → calcul risc → Capital.com → confirmare broker → Telegram`.

Protecțiile implementate sunt:

- numai identificatorii `SMC-LIVE-*` cu `execution_mode=LIVE` pot ajunge la broker;
- planurile `PENDING`, semnalele WATCH, testele și webhook-urile manuale nu pot deschide poziții;
- scor adaptiv minim separat, implicit 85;
- limită de risc de știri, implicit 75/100;
- risc calculat din sold, implicit 0,2% pentru întregul semnal;
- maximum trei semnale executate pe zi și maximum 12 poziții totale deschise;
- maximum o expunere pe același instrument;
- verificare spread și abatere față de Entry înainte de ordin;
- Entry, SL și TP1–TP3 trebuie să fie strict ordonate;
- mărimea este rotunjită în jos la incrementul permis de broker;
- sunt create trei poziții egale, cu același SL și TP1, TP2, respectiv TP3;
- fiecare răspuns `POST /positions` este verificat prin `GET /confirms/{dealReference}`;
- dacă una dintre cele trei poziții este respinsă, pozițiile deja deschise în acea execuție sunt închise automat;
- după detectarea TP1, serverul încearcă mutarea SL la Entry pentru pozițiile TP2 și TP3;
- același `external_id` nu poate fi executat de două ori, nici după restart;
- toate încercările sunt salvate în `capital_executions` și apar în pagina Administrare.

Capital.com permite un singur TP pentru fiecare poziție. Din acest motiv TP1–TP3 sunt implementate ca trei poziții independente. Mutarea la break-even depinde de următoarea lumânare M5 primită de server; SL-ul inițial și cele trei TP-uri sunt însă trimise direct brokerului odată cu ordinele.

### Variabile Render pentru DEMO

Generează cheia în Capital.com Demo la **Settings → API integrations**. `CAPITAL_API_PASSWORD` este parola personalizată a cheii API, nu parola principală a contului.

```text
CAPITAL_AUTO_TRADING_ENABLED=true
CAPITAL_ENVIRONMENT=DEMO
CAPITAL_API_KEY=cheia API afișată la creare
CAPITAL_API_IDENTIFIER=emailul/loginul Capital.com
CAPITAL_API_PASSWORD=parola personalizată a cheii API
CAPITAL_ACCOUNT_ID=opțional; necesar doar dacă ai mai multe conturi
CAPITAL_MIN_ADAPTIVE_SCORE=85
CAPITAL_MAX_NEWS_RISK=75
CAPITAL_RISK_PERCENT=0.2
CAPITAL_MAX_DAILY_SIGNALS=3
CAPITAL_MAX_OPEN_POSITIONS=12
CAPITAL_MAX_ENTRY_SLIPPAGE_R=0.15
CAPITAL_MAX_SPREAD_R=0.1
CAPITAL_ALLOWED_SYMBOLS=US30,NAS100,XAUUSD,GER40,USOIL
```

După deploy, introdu `ADMIN_KEY` în pagina **Administrare** și apasă **Testează conexiunea**. Testul nu deschide ordine.

### Blocarea mediului LIVE

Setarea `CAPITAL_ENVIRONMENT=LIVE` nu este suficientă. Pentru a permite ordine reale trebuie adăugată și valoarea exactă:

```text
CAPITAL_LIVE_TRADING_CONFIRMED=I_UNDERSTAND_LIVE_RISK
```

Nu activa mediul LIVE înainte ca execuția DEMO, dimensiunile și simbolurile Capital.com să fie verificate separat. Credențialele rămân numai în Environment Variables din Render și nu se introduc în Pine, TradingView sau URL-ul webhook-ului.

Instrumentele configurate integral sunt `US30`, `NAS100`, `XAUUSD`, `GER40` și `USOIL`: colectare TradingView, planuri SMC, reanalizare până la TP/SL, Telegram, știri, istoric Dukascopy și backtest. Pentru fiecare instrument trebuie creată propria alertă a colectorului pe graficul M5.

Motorul separă două momente:

1. **PLAN SMC / PENDING** — este identificat un order block și sunt calculate Entry, SL, TP1, TP2 și TP3. Mesajul spune explicit să nu intri la prețul curent.
2. **SEMNAL LIVE** — este trimis separat numai dacă prețul revine la intrarea planificată fără să invalideze SL și o lumânare M5 respinge zona în direcția planului.

## Reguli SMC implementate

SMC nu are o specificație tehnică universală. În v19.0 regulile sunt explicite și testabile:

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

## Grafic live în aplicație

Fiecare semnal deschis are butonul **Grafic live**. Fereastra folosește biblioteca TradingView Lightweight Charts, servită direct de aplicație, și afișează:

- lumânările M5 primite de la alerta TradingView/Capital.com;
- selectare M5, M15, M30, H1 sau H4;
- marcajul BUY/SELL la momentul semnalului;
- liniile Entry, SL și TP1–TP3;
- prețul ultimei lumânări, progresul în R și etapa curentă a tranzacției;
- vechimea ultimei lumânări, astfel încât un flux TradingView oprit să fie vizibil imediat;
- actualizare instantanee în interfață prin flux SSE, fără reîncărcarea paginii.

Graficul folosește exact lumânările salvate de colector, nu un feed separat. De aceea nivelurile rămân aliniate cu motorul și mesajul Telegram. „Live” înseamnă actualizare la închiderea lumânării M5; aplicația nu inventează tick-uri între două webhook-uri TradingView.

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
3. Verifică `/health`: `version` trebuie să fie `19.0.1`.
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

Migrarea bazei de date este automată la pornire. v19.0 păstrează funcțiile v18.7 și adaugă jurnalul securizat de execuție Capital.com:

- separă implicit statisticile și validarea SMC de Legacy și Modele istorice;
- păstrează distinct stările WATCH, eligibil LIVE și Telegram trimis;
- aplică circuit breaker separat pe familie de motor și instrument;
- marchează BUY în PREMIUM și SELL în DISCOUNT drept observații neacționabile;
- retrage planurile PENDING suprapuse, păstrând zona cu scorul cel mai bun;
- rulează reconstruirea intervalelor în fundal și refuză înlocuirea dacă istoricul M5 este insuficient;
- cere minimum 60 de zile pentru un backtest raportat drept relevant.
- adaugă GER40 și USOIL în normalizarea brokerilor și în descărcarea istorică Dukascopy (`deuidxeur`, respectiv `lightcmdusd`).
- adaugă API-ul de lumânări și fluxul live SSE pentru graficul semnalelor active, fără modificarea schemei bazei de date.

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

FMP este oprit implicit. Dacă variabila a rămas activă, dar abonamentul răspunde HTTP 402, v19.0 oprește automat FMP pentru sesiunea serverului și continuă sincronizarea fluxurilor oficiale gratuite. Fluxurile Federal Reserve și BLS acoperă contextul SUA, ECB alimentează contextul GER40, iar EIA furnizează titluri energetice relevante pentru USOIL, toate fără chei API. Dacă nu există calendar anticipat, motorul aplică risc de siguranță în loc de risc zero.

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
