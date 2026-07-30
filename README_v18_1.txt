PROPTRADER AI v18.1 — REZUMAT ACTUALIZARE

- Motor SMC predictiv pe M5, M15, M30, H1 și H4, cu bias D1/H4.
- Planul PENDING indică order block, Entry, SL și TP1–TP3 fără intrare instant.
- Activarea LIVE cere retest și respingere confirmată pe M5.
- Noul indicator PropTrader_AI_v18_1_SMC_Visual.pine desenează zona Entry, SL și TP1–TP3 direct pe graficul TradingView.
- Indicatorul vizual nu creează alerte; colectorul webhook existent rămâne separat.
- Rezultatele TP1/TP2/TP3/SL/BE sunt urmărite în R și ajustează modelele similare.
- FMP rămâne oprit implicit pentru a evita HTTP 402 pe planurile incompatibile.
- Colectorul Pine v17.1 rămâne compatibil; nu recrea alerta dacă webhook-ul funcționează deja.
- După deploy, /health trebuie să afișeze 18.1.0.

Citește README.md pentru regulile SMC, variabilele Render și pașii de instalare.
