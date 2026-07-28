PropTrader AI v12.0 — Robust Validation

Noutăți:
- validare temporală 80/20 pe tranzacții nevăzute
- interval Wilson pentru probabilități, nu doar win rate brut
- rezultate recente ponderate mai mult
- mod LIVE / WATCH pentru fiecare semnal
- circuit breaker după pierderi consecutive
- filtru de risc al știrilor
- clasificare simplă a regimului: TREND, RANGE, HIGH_VOL, MIXED
- scor de calitate și motiv explicit al deciziei

Variabile Render recomandate:
LIVE_MIN_ADAPTIVE_SCORE=72
LEARNING_MIN_SAMPLES=30
VALIDATION_MIN_TRADES=60
MAX_NEWS_RISK_LIVE=75
MAX_CONSECUTIVE_LOSSES=4

Important: aplicația estimează probabilități istorice și nu garantează profit. Testează în demo/forward test înainte de capital real.
