PropTrader AI v15.1 — Stability Release

Corecții:
- retry automat cu backoff pentru loturile Dukascopy;
- loturi mai mici (implicit 30 zile) pentru a reduce timeout-urile Render;
- reluare după ultimul lot reușit;
- normalizare răspuns Dukascopy (array/data/rows/candles);
- protecție împotriva erorii „rows.map is not a function”;
- jurnal de progres disponibil în statusul downloaderului;
- teste automate minimale cu npm test;
- versiune /health: 15.1.0.

Variabile opționale Render:
HISTORY_CHUNK_DAYS=30
HISTORY_RETRY_ATTEMPTS=4
HISTORY_RETRY_BASE_MS=2000

Instalare:
1. Înlocuiește proiectul GitHub cu fișierele din arhivă.
2. Commit și deploy pe Render.
3. Verifică /health => 15.1.0.
4. Repornește descărcarea. Dacă eșuează, apasă din nou; va relua de la ultimul lot reușit cât timp instanța nu a fost repornită.

Notă: persistența jobului între restarturi Render va fi adăugată într-o versiune ulterioară; datele deja salvate nu se dublează datorită cheii unice.
