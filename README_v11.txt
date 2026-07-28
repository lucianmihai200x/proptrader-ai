PROP TRADER AI v11.0 — NEWS FUSION

NOU
- Calendar economic FMP (opțional)
- Știri și sentiment Alpha Vantage (opțional)
- Știri generale de piață Finnhub (opțional)
- Sincronizare comună; aplicația funcționează cu una sau mai multe surse
- Eliminare din listă a știrilor prea vechi
- Relevanță, sentiment, încredere, provider și instrumente afectate
- Calendarul programat rămâne vizibil chiar dacă este în viitor
- Semnalele continuă să fie penalizate când riscul știrilor este mediu/ridicat

VARIABILE RENDER
Obligatorii deja existente:
DATABASE_URL, WEBHOOK_KEY, ADMIN_KEY

Cel puțin una pentru știri:
FMP_API_KEY=
ALPHAVANTAGE_API_KEY=
FINNHUB_API_KEY=

Opționale:
NEWS_AUTO_SYNC_MINUTES=60
NEWS_MAX_AGE_HOURS=96
NEWS_MIN_RELEVANCE=35
NEWS_COUNTRIES=US
AUTO_TRACK_TRADES=true

PAȘI
1. Înlocuiește în GitHub fișierele din acest ZIP.
2. Commit changes.
3. Așteaptă deploy-ul Render.
4. Verifică /health — version trebuie să fie 11.0.0.
5. Adaugă cel puțin o cheie de știri în Render Environment.
6. În Administrare apasă „Sincronizează știri reale”.

NOTĂ
Clasificarea știrilor și probabilitățile sunt filtre statistice/euristice, nu garanții de tranzacționare. Nu se execută ordine automat.
