# PropTrader CORE DEMO — TradingView → Capital.com DEMO

Acest modul este separat de aplicația principală și este construit pentru validare DEMO rapidă a strategiei `Scalping Professional Engine v3.2 CORE`.

## Siguranțe hard-coded

- API broker: **Capital.com DEMO** exclusiv.
- Active permise: **XAUUSD, US30, US100**.
- **GER40 și USOIL sunt blocate** chiar dacă apar accidental într-o variabilă de mediu.
- O singură poziție per setup.
- Management broker-side: **SL + TP2 pentru 100% din poziție**.
- Risc configurabil, plafonat în cod la **0,20%**.
- Respinge duplicatele `setup_id`.
- Respinge o intrare dacă există deja o poziție pe același instrument.
- Verifică market status, spread, slippage și distanțele minime de SL/TP raportate de broker.
- `TP1`, `TP2`, `TP3` și `SL` venite ulterior din Pine sunt ignorate de bridge, deoarece SL/TP2 sunt deja la broker.
- `TIME_EXIT` și `STAGNATION_EXIT` pot închide poziția mapată exact acelui `setup_id`.

## Deploy recomandat pe Render

Nu modifica serviciul PropTrader AI existent. Creează un **Web Service nou** din același repository:

- Branch: `demo-core-v3-2-integration`
- Build command: `npm install`
- Start command: `node core_demo_bridge.js`
- Health check path: `/health`

Poți folosi aceeași bază Postgres (`DATABASE_URL`) pentru jurnalul `core_demo_executions`, fără să modifici tabelele existente ale aplicației principale.

## Variabile Render

Obligatorii:

```text
CORE_DEMO_ENABLED=false
CORE_DEMO_ALLOWED_SYMBOLS=XAUUSD,US30,US100
CORE_DEMO_RISK_PERCENT=0.20
CORE_DEMO_MAX_DAILY_ORDERS=3
CORE_DEMO_MAX_OPEN_POSITIONS=3
CORE_DEMO_MAX_ENTRY_SLIPPAGE_R=0.15
CORE_DEMO_MAX_SPREAD_R=0.10
WEBHOOK_KEY=<cheie secretă>
CAPITAL_API_KEY=<cheia API Capital.com>
CAPITAL_API_IDENTIFIER=<email/identifier API>
CAPITAL_API_PASSWORD=<parola API/cont folosită de API>
CAPITAL_ACCOUNT_ID=<opțional; contul DEMO dorit>
DATABASE_URL=<recomandat; poate fi DB-ul PropTrader existent>
```

Opționale:

```text
CAPITAL_EPIC_MAP={"XAUUSD":"GOLD","US30":"US30","US100":"US100"}
CORE_DEMO_MAX_SIZE_BY_SYMBOL={"XAUUSD":1,"US30":1,"US100":1}
CAPITAL_GUARANTEED_STOP=false
CORE_DEMO_MIN_SCORE=0
```

`CORE_DEMO_ENABLED` trebuie ținut `false` până când testul de conexiune reușește.

## Test conexiune

După deploy:

```text
POST https://<serviciul-core>.onrender.com/test-connection?key=<WEBHOOK_KEY>
```

Răspunsul trebuie să conțină:

```json
{
  "ok": true,
  "environment": "DEMO"
}
```

Abia după aceea setează:

```text
CORE_DEMO_ENABLED=true
```

și redeploy/restart.

## TradingView

Scriptul LIVE v3.2 CORE emite deja payload compatibil, inclusiv:

- `event`
- `setup_id`
- `symbol`
- `side`
- `entry`
- `sl`
- `tp2`
- `score`
- `risk_pct`

Creează câte o alertă pe:

1. XAUUSD M1
2. US30 M1
3. US100/NAS100 M1

Nu crea alertă pentru GER40 sau USOIL.

La fiecare alertă:

- Condition: `Scalping Professional Engine v3.2 CORE [LIVE]`
- Trigger: **Any alert() function call**
- Webhook URL:

```text
https://<serviciul-core>.onrender.com/core-webhook?key=<WEBHOOK_KEY>
```

Mesajul nu trebuie completat manual; Pine folosește `alert()` și trimite JSON-ul construit în script.

## Ordinea de pornire

1. Deploy branch-ul CORE ca serviciu Render separat.
2. Completează credentialele Capital.com DEMO.
3. Lasă `CORE_DEMO_ENABLED=false`.
4. Rulează `/test-connection`.
5. Confirmă în `/status` că apar:
   - `environment: DEMO`
   - `hardLiveLock: true`
   - `allowedSymbols: XAUUSD, US30, US100`
6. Setează `CORE_DEMO_ENABLED=true`.
7. Creează alertele TradingView doar pe cele 3 active.
8. Prima execuție se verifică în Capital.com DEMO și în tabela `core_demo_executions`.

## Notă despre risc

Bridge-ul plafonează parametrul de risc la 0,20% și aplică limite de mărime, spread și slippage. Valoarea monetară exactă a riscului unui CFD depinde însă de specificațiile contractului și de moneda contului. Primele ordine trebuie verificate pe DEMO înainte de orice utilizare ulterioară.
