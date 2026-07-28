PROPTRADER AI v9.1

FUNCȚII NOI
- Prețul semnalului real vine din payload-ul TradingView.
- Semnalul de test cere un preț introdus manual; nu mai folosește 45.000.
- Colector BAR pentru OHLCV real.
- Model statistic pe ora/minutul zilei, cu istoric configurabil.
- Intrare statistică numai când sunt îndeplinite simultan:
  1) număr minim de observații;
  2) probabilitate minimă;
  3) mișcare medie relevantă față de ATR;
  4) confirmare EMA20/EMA50;
  5) fără știre cu impact >= 80;
  6) cooldown între sugestii.

VARIABILE RENDER OPȚIONALE
PATTERN_MIN_SAMPLES=25
PATTERN_MIN_PROBABILITY=68
PATTERN_LOOKBACK_DAYS=180
PATTERN_HORIZON_BARS=3
PATTERN_COOLDOWN_MINUTES=60

CONFIGURARE TRADINGVIEW
1. Adaugă PropTrader_AI_v9_1_Market_Collector.pine pe grafic.
2. Creează o alertă cu Condition = Any alert() function call.
3. Webhook URL:
   https://proptrader-ai-v1.onrender.com/webhook?key=CHEIA_TA_WEBHOOK
4. Creează colectoare separate pentru US30, XAUUSD și NAS100, pe timeframe-ul analizat.
5. Datele încep să se acumuleze din momentul activării. TradingView nu retrimite automat toate lumânările istorice prin alertă.

NOTĂ
Probabilitatea este o frecvență istorică estimată, nu o garanție. Pentru rezultate utile sunt necesare suficiente lumânări și regimuri diferite de piață.
