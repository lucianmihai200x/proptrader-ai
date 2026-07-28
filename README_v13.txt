PropTrader AI v13.0 – Historical Backtest

Noutăți:
- import CSV OHLCV din browser, fără programe instalate;
- stocare în PostgreSQL cu deduplicare;
- verificări pentru lumânări invalide;
- backtest al modelelor orare pe instrument/timeframe;
- separare temporală 80% învățare / 20% validare;
- interval Wilson, profit factor, rezultat mediu și drawdown;
- modelele sunt marcate robuste numai dacă rămân pozitive pe date nevăzute.

Format CSV acceptat:
Date sau Datetime, Open, High, Low, Close, opțional Volume.
Dacă fișierul are coloane separate Date și Time, coloana Time poate fi denumită Clock, Hour sau Ora.

După deploy verifică /health: version 13.0.0.
