PROPTRADER AI v19.0.1 — CAPITAL.COM AUTO-TRADING

NOU:
- execută exclusiv semnale SMC LIVE confirmate, niciodată planuri PENDING sau semnale test;
- verifică din nou scorul, știrile, spreadul, Entry, SL și TP1–TP3;
- calculează o mărime cu risc implicit de maximum 0,2% din sold;
- deschide trei poziții egale: una pentru TP1, una pentru TP2 și una pentru TP3;
- toate cele trei poziții primesc SL direct la Capital.com;
- confirmă fiecare ordin prin endpoint-ul oficial /confirms;
- dacă o poziție din set este respinsă, închide pozițiile deschise anterior în aceeași execuție;
- blochează ordinele duplicate prin baza de date;
- după TP1 încearcă mutarea SL la Entry pentru pozițiile TP2 și TP3;
- salvează jurnalul execuțiilor și îl afișează în Administrare;
- trimite pe Telegram confirmarea ordinului executat sau avertizarea de rollback;
- serializează autentificarea, respectând limita Capital.com de o sesiune pe secundă.

SIGURANȚĂ:
- auto-trading este OPRIT implicit;
- mediul implicit este DEMO;
- LIVE necesită valoarea exactă CAPITAL_LIVE_TRADING_CONFIRMED=I_UNDERSTAND_LIVE_RISK;
- testul conexiunii nu deschide ordine;
- credențialele se păstrează numai în Render Environment Variables.

CONFIGURARE MINIMĂ DEMO ÎN RENDER:
CAPITAL_AUTO_TRADING_ENABLED=true
CAPITAL_ENVIRONMENT=DEMO
CAPITAL_API_KEY=cheia API Capital.com
CAPITAL_API_IDENTIFIER=email/login Capital.com
CAPITAL_API_PASSWORD=parola personalizată a cheii API
CAPITAL_RISK_PERCENT=0.2
CAPITAL_MIN_ADAPTIVE_SCORE=85

După deploy, /health trebuie să afișeze versiunea 19.0.1. În Administrare introdu ADMIN_KEY și apasă „Testează conexiunea”.

IMPORTANT:
Înainte de LIVE, verifică mai multe execuții DEMO și confirmă manual mărimea pozițiilor, SL-ul și cele trei TP-uri pentru fiecare instrument.
