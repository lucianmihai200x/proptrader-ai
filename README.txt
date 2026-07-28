PROPTRADER AI v5 — VALIDARE ȘI STATISTICI

Actualizare GitHub:
- înlocuiește package.json
- înlocuiește server.js
- înlocuiește public/index.html
- păstrează render.yaml sau înlocuiește-l cu cel inclus
- adaugă PropTrader_AI_v5_Engine.pine

Funcții noi:
- statistici pe instrument
- statistici pe sesiune
- statistici pe oră
- curba rezultatelor în R
- export CSV
- jurnal și rezultate TP/SL
- filtre după simbol, direcție, status și scor

Test:
1. După redeploy, introdu ADMIN_KEY.
2. Creează mai multe semnale test.
3. Închide-le manual cu TP1, TP2, TP3, SL sau BE.
4. Verifică actualizarea statisticilor și a curbei.
5. Descarcă CSV cu butonul Export CSV.

Motorul Pine rămâne compatibil cu fluxul v4.
