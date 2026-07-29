# PropTrader AI v16.3

Versiune concentrată pe două obiective:

- analiză selectivă US30 la fiecare închidere M15;
- backtest conservator, fără direcție aleasă cu informație din viitor.

## Fișier TradingView

Folosește numai:

`PropTrader_AI_v16_3_M15_Signal_Engine.pine`

Scriptul trimite prin aceeași alertă:

- un eveniment `BAR` la fiecare lumânare M15 închisă;
- un eveniment `SIGNAL` numai când setup-ul trece scorul minim.

## Deploy

1. Înlocuiește fișierele repository-ului.
2. Commit.
3. Render → Manual Deploy → Deploy latest commit.
4. Verifică `/health`: `version` trebuie să fie `16.3.0`, iar `analysisTimeframe` trebuie să fie `15`.

Instrucțiunile complete sunt în `README_v16_3.txt`.
