PROPTRADER AI v18.2 — REZUMAT ACTUALIZARE

- Motor SMC predictiv pe M5, M15, M30, H1 și H4, cu bias D1/H4.
- Planul PENDING indică order block, Entry, SL și TP1–TP3 fără intrare instant.
- Activarea LIVE cere retest și respingere confirmată pe M5.
- US100, USTEC și NAS100 sunt unificate automat sub NAS100.
- TP1, TP2 și TP3 rămân ordonate și separate cu minimum 0,35R.
- Noul indicator PropTrader_AI_v18_2_SMC_Visual.pine desenează zona Entry, SL și TP1–TP3 direct pe graficul TradingView.
- Indicatorul marchează WATCH sub pragul Telegram și păstrează ultimul plan în gri.
- Indicatorul vizual nu creează alerte; colectorul webhook existent rămâne separat.
- Rezultatele TP1/TP2/TP3/SL/BE sunt urmărite în R și ajustează modelele similare.
- FMP rămâne oprit implicit și este dezactivat automat în sesiune după HTTP 402, fără să oprească fluxurile oficiale.
- Telegram indică sursa semnalului și jurnalizează motivele pentru mesajele omise.
- Colectorul Pine v17.1 rămâne compatibil; nu recrea alerta dacă webhook-ul funcționează deja.
- După deploy, /health trebuie să afișeze 18.2.0.

Citește README.md pentru regulile SMC, variabilele Render și pașii de instalare.
