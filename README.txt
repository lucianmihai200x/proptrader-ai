PropTrader AI v9.0

Funcții:
- jurnal activ: numai semnalele nearhivate;
- arhivare automată după 24 ore (configurabil prin ARCHIVE_AFTER_HOURS);
- arhivă separată și export CSV;
- scor adaptiv bazat pe performanța setup-urilor închise;
- modul de știri cu impact, bias și instrumente relevante;
- penalizare automată a scorului în jurul știrilor cu impact mediu/ridicat.

Variabile Render:
DATABASE_URL = baza PostgreSQL
WEBHOOK_KEY = cheia alertelor TradingView
ADMIN_KEY = cheia de administrare
NEWS_WEBHOOK_KEY = cheia fluxului de știri (opțional; implicit WEBHOOK_KEY)
ARCHIVE_AFTER_HOURS = 24

TradingView:
POST /webhook?key=WEBHOOK_KEY

Flux de știri:
POST /news-webhook?key=NEWS_WEBHOOK_KEY
Content-Type: application/json
Exemplu:
{
  "external_id":"news-123",
  "published_at":"2026-07-28T15:00:00Z",
  "title":"FOMC interest rate decision",
  "summary":"Federal Reserve announces its rate decision",
  "source":"Economic feed",
  "symbols":["US30","NAS100","XAUUSD"]
}

Observație:
Modulul învață statistic numai din tranzacții închise. Ajustarea este limitată la +/-12 puncte și capătă greutate treptat până la minimum 30 de exemple, pentru a reduce supraînvățarea.
