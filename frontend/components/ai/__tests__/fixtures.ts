/* Fixtures recorded from the real S4 backend (demo data), trimmed. Used by render.test.ts / model.test.ts. */
import type { StrategyViewData, TeacherAnswerData } from "../types";

export const analyzeAnswer: TeacherAnswerData = {
 "mode": "analyze",
 "title": "ANALYZE · BTC/USDT 1H",
 "symbol": "BTC/USDT",
 "timeframe": "1h",
 "sections": [
  {
   "key": "observation",
   "title": "OBSERVATION",
   "body": [
    "BTC/USDT 1H · данни DEMO: последна ЗАТВОРЕНА свещ 2026-10-07 18:00 UTC.",
    "Цена 106,735.28; последна затворена свещ: O 105,575.70 H 106,742.64 L 104,936.27 C 106,735.28.",
    "EMA 20 105,087.91, EMA 50 104,414.37, EMA 200 104,531.63.",
    "RSI(14) 60.7; MACD хистограма -46.80 (расте)."
   ]
  },
  {
   "key": "rules",
   "title": "RULES",
   "body": [
    "Стратегия 'Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)' (по подразбиране — последната ти стратегия):",
    "✗ LONG: EMA(20) (105,087.91) е над EMA(50) (104,414.37), но пресичане нагоре на последната затворена свещ няма → не е изпълнено.",
    "✓ LONG: Close = 106,735.28, EMA(200) = 104,531.63; правилото иска Close над EMA(200) → изпълнено.",
    "✗ SHORT: EMA(20) (105,087.91) е над EMA(50) (104,414.37), но пресичане надолу на последната затворена свещ няма → не е изпълнено."
   ]
  },
  {
   "key": "scenario",
   "title": "SCENARIO",
   "body": [
    "Контекст: режим UNCLEAR (Сигналите не съвпадат (ADX 28, наклон +0.3 ATR, цена над EMA 50).); Higher highs и higher lows — бичя структура (uptrend). Momentum: Weak / mixed.",
    "Стратегията 'Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)': NO SETUP — LONG: изпълнени 1 от 2 условия (нужни са всички условия (AND)). Не е изпълнено: EMA(20) пресича нагоре EMA(50).",
    "Signal engine (общ анализ): NO TRADE — Trend pullback (продължение на uptrend). Хипотеза: движение към 107,833.53 (R:R 0.38), докато 103,874.33 не бъде пробито.",
    "Confidence LOW: Confidence НЕ означава вероятност за печалба — показва само колко фактора съвпадат."
   ]
  },
  {
   "key": "invalidation",
   "title": "INVALIDATION",
   "body": [
    "Engine setup: invalidation 103,874.33. Ако цената падне под 103,874.33, идеята е невалидна (риск 2,860.95 на единица, 2.5 ATR).",
    "Ключови нива: support 106,484.34 и resistance 107,833.53 — затваряне извън тях би променило картината.",
    "Бичата структура (HH + HL) се нарушава при затваряне под последното HL 103,716.82."
   ]
  },
  {
   "key": "risk",
   "title": "RISK",
   "body": [
    "Волатилност High: ATR(14) 1,138.95 = 1.07% от цената (ранг 86/100).",
    "По-висока волатилност → по-широк stop и по-малка позиция при същия риск в пари.",
    "Position sizing по правилото ти 1% риск: equity 10,000.00 → максимален риск 100.00 → размер ≈ 0.03495 единици при stop разстояние 2,860.95.",
    "Рискови фактори от no-trade системата: Poor risk/reward."
   ]
  },
  {
   "key": "alternative",
   "title": "ALTERNATIVE SCENARIO",
   "body": [
    "Алтернативен сценарий: цената пробива 103,874.33 — тогава setup-ът е невалиден и пазарът вероятно продължава в обратна посока или влиза в range.",
    "Ако 'EMA(20) пресича нагоре EMA(50)' се изпълни на следваща затворена свещ (и останалите условия останат), стратегията би показала setup.",
    "Пазарът може да остане и без ясна посока — тогава NO TRADE е валидно решение."
   ]
  },
  {
   "key": "examples",
   "title": "HISTORICAL EXAMPLES",
   "body": [
    "16 исторически примера (бари в режим UNCLEAR с RSI(14) между 60 и 70 (като сега)). След 10 свещи медианното движение е -0.09 ATR (+ = нагоре) (среден 50%: -0.79 … +1.07 ATR); +1R преди −1R: 38%, −1R първо: 50%, нито едно: 12% (1R = 1 ATR(14)). Минали примери (past examples, not a forecast): показват как се е движила цената след подобни условия в историята, не какво ще се случи сега."
   ]
  }
 ],
 "follow_ups": [
  {
   "label": "WHY? Защо това решение?",
   "mode": "why",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "EXPLAIN — обясни setup-а",
   "mode": "explain",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "TEACH ME: Market structure",
   "mode": "teach",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "topic": "market-structure"
   }
  },
  {
   "label": "QUIZ ME върху тази графика",
   "mode": "quiz",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "COMPARE с 4H",
   "mode": "compare",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "compare_timeframe": "4h"
   }
  }
 ],
 "context_used": [
  {
   "key": "chart",
   "label": "Графика BTC/USDT 1H",
   "available": true,
   "detail": "DEMO · UNCLEAR · RSI 60.7 · NO TRADE",
   "values": {
    "Последна цена": "106,462.55",
    "Режим": "UNCLEAR",
    "Структура": "HH + HL",
    "RSI(14)": "60.7",
    "ATR%": "1.07%",
    "Обем / ср.": "0.44×"
   }
  },
  {
   "key": "strategy",
   "label": "Стратегия: Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)",
   "available": true,
   "detail": "NO SETUP · по подразбиране",
   "values": {
    "Резултат": "NO SETUP",
    "LONG": "1/2 условия",
    "SHORT": "0/2 условия",
    "Regime filter": "OK (UNCLEAR)"
   }
  },
  {
   "key": "historical_examples",
   "label": "Исторически примери",
   "available": true,
   "detail": "16 минали случая — past examples, not a forecast",
   "values": {
    "Случаи": "16",
    "Хоризонт": "10 свещи",
    "Медиана": "-0.09 ATR",
    "+1R първо": "38%",
    "−1R първо": "50%"
   }
  },
  {
   "key": "account",
   "label": "Paper сметка",
   "available": true,
   "detail": "Equity 10,000.00 · 0 отворени позиции",
   "values": {
    "Equity": "10,000.00",
    "Balance": "10,000.00",
    "Free margin": "10,000.00",
    "Отворени позиции": "0",
    "Exposure": "0.00",
    "Риск правило": "1.00%"
   }
  }
 ],
 "provider": "offline",
 "provider_label": "OFFLINE",
 "fallback": false,
 "llm_rejected_sections": [],
 "disclaimer": "This is a rule-based hypothetical setup, not a guarantee of future price movement. Това е образователен анализ, не финансов съвет. Няма гарантирани резултати в trading-а.",
 "safety_removed": [],
 "safety_note": null,
 "data_available": true,
 "examples": {
  "available": true,
  "basis": "analog",
  "horizon": 10,
  "bars_scanned": 940,
  "count": 16,
  "note": "Минали примери (past examples, not a forecast): показват как се е движила цената след подобни условия в историята, не какво ще се случи сега.",
  "regime": "UNCLEAR",
  "rsi_band": [
   60.0,
   70.0
  ],
  "criteria": "бари в режим UNCLEAR с RSI(14) между 60 и 70 (като сега)",
  "r_unit": "1 ATR(14)",
  "direction": "price",
  "median_move_atr": -0.09,
  "p25_move_atr": -0.79,
  "p75_move_atr": 1.07,
  "plus_first_pct": 38,
  "minus_first_pct": 50,
  "neither_pct": 12,
  "reliable": true,
  "summary": "16 исторически примера (бари в режим UNCLEAR с RSI(14) между 60 и 70 (като сега)). След 10 свещи медианното движение е -0.09 ATR (+ = нагоре) (среден 50%: -0.79 … +1.07 ATR); +1R преди −1R: 38%, −1R първо: 50%, нито едно: 12% (1R = 1 ATR(14)). Минали примери (past examples, not a forecast): показват как се е движила цената след подобни условия в историята, не какво ще се случи сега."
 },
 "strategy": {
  "id": 8,
  "name": "Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)",
  "selected": false,
  "source": "recent",
  "result": "NO SETUP"
 },
 "overlay": {
  "support": [
   106484.34,
   105572.05
  ],
  "resistance": [
   107833.53,
   108747.27
  ],
  "swings": [
   {
    "index": 362,
    "time": 1791262800,
    "price": 100488.4,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 367,
    "time": 1791280800,
    "price": 100474.55,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 380,
    "time": 1791327600,
    "price": 110345.78,
    "kind": "high",
    "label": "HH"
   },
   {
    "index": 392,
    "time": 1791370800,
    "price": 103716.82,
    "kind": "low",
    "label": "HL"
   }
  ],
  "setup": {
   "side": "long",
   "entry": 106735.28,
   "stop": 103874.33,
   "target": 107833.53,
   "source": "engine"
  },
  "draft": null
 },
 "session_id": 1,
 "generated_ts": 1791402197
};

export const quizAnswer: TeacherAnswerData = {
 "mode": "quiz",
 "title": "QUIZ ME · BTC/USDT 1H",
 "symbol": "BTC/USDT",
 "timeframe": "1h",
 "sections": [
  {
   "key": "quiz",
   "title": "QUIZ",
   "body": [
    "5 въпроса: 3 от академията и 2 от текущата графика.",
    "Фокус: Level 0 — Absolute Beginner (модулът още не е започнат).",
    "Избери отговор, за да видиш обяснението. Целта е разбиране, не точки."
   ]
  }
 ],
 "follow_ups": [
  {
   "label": "QUIZ ME — нови въпроси",
   "mode": "quiz",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  }
 ],
 "context_used": [
  {
   "key": "chart",
   "label": "Графика BTC/USDT 1H",
   "available": true,
   "detail": "DEMO · UNCLEAR · RSI 60.7 · NO TRADE",
   "values": {
    "Последна цена": "106,462.55",
    "Режим": "UNCLEAR",
    "Структура": "HH + HL",
    "RSI(14)": "60.7",
    "ATR%": "1.07%",
    "Обем / ср.": "0.44×"
   }
  },
  {
   "key": "learning",
   "label": "Академия",
   "available": true,
   "detail": "Ниво 1 · 0/117 урока",
   "values": {
    "Ниво": "1",
    "XP": "0",
    "Уроци": "0/117",
    "Quiz-ове (passed)": "0"
   }
  }
 ],
 "provider": "offline",
 "provider_label": "OFFLINE",
 "fallback": false,
 "llm_rejected_sections": [],
 "disclaimer": "Това е образователен анализ, не финансов съвет. Няма гарантирани резултати в trading-а.",
 "safety_removed": [],
 "safety_note": null,
 "data_available": true,
 "quiz": {
  "questions": [
   {
    "id": "bank:l0-6",
    "question": "Защо stop loss може да се изпълни на по-лоша цена от зададената?",
    "options": [
     "Бъг в платформата",
     "Gap или бърз пазар (slippage)",
     "Защото е limit поръчка",
     "Не може"
    ],
    "answer_index": 1,
    "explanation": "Stop става market поръчка; при gap се изпълнява на първата налична цена.",
    "source": "academy",
    "module": "level0",
    "module_title": "Level 0 — Absolute Beginner",
    "lesson": null
   },
   {
    "id": "bank:l0-7",
    "question": "Какво е liquidation?",
    "options": [
     "Затваряне на позиция с печалба",
     "Принудително затваряне при недостатъчен margin",
     "Теглене на пари",
     "Нова позиция"
    ],
    "answer_index": 1,
    "explanation": "Когато equity падне под изискуемото ниво, брокерът затваря позиции.",
    "source": "academy",
    "module": "level0",
    "module_title": "Level 0 — Absolute Beginner",
    "lesson": null
   },
   {
    "id": "bank:l0-4",
    "question": "При leverage 10:1 цената се движи 5% срещу теб. Колко губиш от margin-а?",
    "options": [
     "5%",
     "10%",
     "50%",
     "100%"
    ],
    "answer_index": 2,
    "explanation": "5% × 10 = 50% от margin-а.",
    "source": "academy",
    "module": "level0",
    "module_title": "Level 0 — Absolute Beginner",
    "lesson": null
   },
   {
    "id": "chart:structure",
    "question": "Каква е структурата на BTC/USDT 1H според последните потвърдени swing точки (последен връх HH, последно дъно HL)?",
    "options": [
     "Lower highs и lower lows — меча структура (downtrend)",
     "Смесена структура — range или преход",
     "Higher highs и higher lows — бичя структура (uptrend)"
    ],
    "answer_index": 2,
    "explanation": "Последният swing high е HH, а последният swing low е HL. HH + HL = бичя структура. Това описва миналото — не гарантира продължение.",
    "source": "chart",
    "module": null,
    "module_title": null,
    "lesson": "market-structure"
   },
   {
    "id": "chart:rsi",
    "question": "RSI(14) на BTC/USDT 1H е 60.7. В коя зона е?",
    "options": [
     "Над 70 — висока (overbought) зона; това НЕ означава автоматично спад",
     "Между 30 и 70 — неутрална зона",
     "Под 30 — ниска (oversold) зона; това НЕ означава автоматично отскок"
    ],
    "answer_index": 1,
    "explanation": "RSI 60.7 е в зона 'Между 30 и 70'. RSI измерва силата на последните движения — сам по себе си не е сигнал за вход.",
    "source": "chart",
    "module": null,
    "module_title": null,
    "lesson": "rsi"
   }
  ],
  "focus": [
   {
    "module": "level0",
    "title": "Level 0 — Absolute Beginner",
    "reason": "модулът още не е започнат"
   }
  ],
  "sources": {
   "academy": 3,
   "chart": 2
  },
  "pass_score": 0.7
 },
 "session_id": 5,
 "generated_ts": 1791402197
};

export const compareAnswer: TeacherAnswerData = {
 "mode": "compare",
 "title": "COMPARE · BTC/USDT 1H vs BTC/USDT 4H",
 "symbol": "BTC/USDT",
 "timeframe": "1h",
 "sections": [
  {
   "key": "comparison",
   "title": "COMPARISON",
   "body": [
    "Режим: BTC/USDT 1H — UNCLEAR | BTC/USDT 4H — UNCLEAR",
    "Структура: BTC/USDT 1H — HH + HL (bullish) | BTC/USDT 4H — HH + LL (mixed)",
    "Волатилност: BTC/USDT 1H — High · ATR 1.067% (ранг 86) | BTC/USDT 4H — High · ATR 1.776% (ранг 88)",
    "Momentum: BTC/USDT 1H — Weak / mixed · RSI 60.7 | BTC/USDT 4H — Moderate bullish · RSI 51.6"
   ]
  },
  {
   "key": "observation",
   "title": "OBSERVATION",
   "body": [
    "BTC/USDT 1H: цена 106,462.55, режим UNCLEAR, структура HH + HL, RSI 60.7, ATR 1.067% (последна затворена свещ 2026-10-07 18:00 UTC).",
    "BTC/USDT 4H: цена 106,462.55, режим UNCLEAR, структура HH + LL, RSI 51.6, ATR 1.776% (последна затворена свещ 2026-10-07 12:00 UTC)."
   ]
  },
  {
   "key": "rules",
   "title": "RULES",
   "body": [
    "BTC/USDT 1H · Strategy fit: NO SETUP (LONG 1/2, SHORT 0/2; regime filter OK)",
    "BTC/USDT 4H · Strategy fit: NO SETUP (LONG 1/2, SHORT 0/2; regime filter OK)",
    "✗ No-trade проверка — Poor risk/reward: Reward:Risk 0.38 е под минимума 1.5.",
    "✗ R:R на engine setup-а 0.38 спрямо минимума ти 1.5."
   ]
  },
  {
   "key": "scenario",
   "title": "SCENARIO",
   "body": [
    "BTC/USDT 1H: signal engine NO TRADE; стратегия NO SETUP (LONG 1/2, SHORT 0/2; regime filter OK).",
    "BTC/USDT 4H: signal engine NO TRADE; стратегия NO SETUP (LONG 1/2, SHORT 0/2; regime filter OK).",
    "Една и съща стратегия може да показва различен резултат на различни пазари/timeframe-ове — правилата се проверяват независимо за всяка графика.",
    "This is a rule-based hypothetical setup, not a guarantee of future price movement."
   ]
  },
  {
   "key": "invalidation",
   "title": "INVALIDATION",
   "body": [
    "Engine setup: invalidation 103,874.33. Ако цената падне под 103,874.33, идеята е невалидна (риск 2,860.95 на единица, 2.5 ATR).",
    "Ключови нива: support 106,484.34 и resistance 107,833.53 — затваряне извън тях би променило картината.",
    "BTC/USDT 4H: ключови нива support 104,079.96 / resistance 106,089.16."
   ]
  },
  {
   "key": "risk",
   "title": "RISK",
   "body": [
    "Волатилност High: ATR(14) 1,138.95 = 1.07% от цената (ранг 86/100).",
    "ATR% на BTC/USDT 4H е 1.7× този на BTC/USDT 1H — при еднакъв риск в пари позицията в BTC/USDT 4H трябва да е около 1.7× по-малка.",
    "Higher leverage magnifies exposure and liquidation risk."
   ]
  },
  {
   "key": "alternative",
   "title": "ALTERNATIVE SCENARIO",
   "body": [
    "Режимите се сменят: сравнението е моментна снимка към последните затворени свещи.",
    "Пазарът може да остане и без ясна посока — тогава NO TRADE е валидно решение."
   ]
  },
  {
   "key": "conclusion",
   "title": "CONCLUSION",
   "body": [
    "Основни разлики между BTC/USDT 1H и BTC/USDT 4H: Структура, Волатилност, Momentum, Разстояние до support, Разстояние до resistance.",
    "Това са разлики, не прогноза (differences, not a prediction)."
   ]
  }
 ],
 "follow_ups": [
  {
   "label": "ANALYZE BTC/USDT 4H",
   "mode": "analyze",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "4h"
   }
  },
  {
   "label": "WHY? BTC/USDT 1H",
   "mode": "why",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "TEACH ME: Market regimes",
   "mode": "teach",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "topic": "market-regimes"
   }
  }
 ],
 "context_used": [
  {
   "key": "chart",
   "label": "Графика BTC/USDT 1H",
   "available": true,
   "detail": "DEMO · UNCLEAR · RSI 60.7 · NO TRADE",
   "values": {
    "Последна цена": "106,462.55",
    "Режим": "UNCLEAR",
    "Структура": "HH + HL",
    "RSI(14)": "60.7",
    "ATR%": "1.07%",
    "Обем / ср.": "0.44×"
   }
  },
  {
   "key": "compare",
   "label": "Сравнение BTC/USDT 4H",
   "available": true,
   "detail": "DEMO · UNCLEAR · NO SETUP",
   "values": {
    "Цена": "106,462.55",
    "Режим": "UNCLEAR",
    "RSI(14)": "51.6",
    "ATR%": "1.78%"
   }
  },
  {
   "key": "strategy",
   "label": "Стратегия: Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)",
   "available": true,
   "detail": "NO SETUP · по подразбиране",
   "values": {
    "Резултат": "NO SETUP",
    "LONG": "1/2 условия",
    "SHORT": "0/2 условия",
    "Regime filter": "OK (UNCLEAR)"
   }
  }
 ],
 "provider": "offline",
 "provider_label": "OFFLINE",
 "fallback": false,
 "llm_rejected_sections": [],
 "disclaimer": "This is a rule-based hypothetical setup, not a guarantee of future price movement. Това е образователен анализ, не финансов съвет. Няма гарантирани резултати в trading-а.",
 "safety_removed": [],
 "safety_note": null,
 "data_available": true,
 "comparison": {
  "left": {
   "symbol": "BTC/USDT",
   "timeframe": "1h",
   "label": "BTC/USDT 1H",
   "available": true
  },
  "right": {
   "symbol": "BTC/USDT",
   "timeframe": "4h",
   "label": "BTC/USDT 4H",
   "available": true
  },
  "rows": [
   {
    "key": "regime",
    "label": "Режим",
    "left": "UNCLEAR",
    "right": "UNCLEAR",
    "different": false
   },
   {
    "key": "structure",
    "label": "Структура",
    "left": "HH + HL (bullish)",
    "right": "HH + LL (mixed)",
    "different": true
   },
   {
    "key": "volatility",
    "label": "Волатилност",
    "left": "High · ATR 1.067% (ранг 86)",
    "right": "High · ATR 1.776% (ранг 88)",
    "different": true
   },
   {
    "key": "momentum",
    "label": "Momentum",
    "left": "Weak / mixed · RSI 60.7",
    "right": "Moderate bullish · RSI 51.6",
    "different": true
   },
   {
    "key": "support",
    "label": "Разстояние до support",
    "left": "106,484.34 (0.02%, 0.0 ATR)",
    "right": "104,079.96 (2.24%, 1.3 ATR)",
    "different": true
   },
   {
    "key": "resistance",
    "label": "Разстояние до resistance",
    "left": "107,833.53 (1.29%, 1.2 ATR)",
    "right": "106,089.16 (0.35%, 0.2 ATR)",
    "different": true
   },
   {
    "key": "strategy",
    "label": "Strategy fit",
    "left": "NO SETUP (LONG 1/2, SHORT 0/2; regime filter OK)",
    "right": "NO SETUP (LONG 1/2, SHORT 0/2; regime filter OK)",
    "different": false
   },
   {
    "key": "decision",
    "label": "Signal engine",
    "left": "NO TRADE",
    "right": "NO TRADE",
    "different": false
   }
  ],
  "note": "Това са разлики, не прогноза (differences, not a prediction)."
 },
 "strategy": {
  "id": 8,
  "name": "Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)",
  "selected": false,
  "source": "recent",
  "result": "NO SETUP"
 },
 "overlay": {
  "support": [
   106484.34,
   105572.05
  ],
  "resistance": [
   107833.53,
   108747.27
  ],
  "swings": [
   {
    "index": 362,
    "time": 1791262800,
    "price": 100488.4,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 367,
    "time": 1791280800,
    "price": 100474.55,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 380,
    "time": 1791327600,
    "price": 110345.78,
    "kind": "high",
    "label": "HH"
   },
   {
    "index": 392,
    "time": 1791370800,
    "price": 103716.82,
    "kind": "low",
    "label": "HL"
   }
  ],
  "setup": {
   "side": "long",
   "entry": 106735.28,
   "stop": 103874.33,
   "target": 107833.53,
   "source": "engine"
  },
  "draft": null
 },
 "session_id": 6,
 "generated_ts": 1791402197
};

export const teachAnswer: TeacherAnswerData = {
 "mode": "teach",
 "title": "TEACH ME · BTC/USDT 1H",
 "symbol": "BTC/USDT",
 "timeframe": "1h",
 "sections": [
  {
   "key": "lesson",
   "title": "LESSON",
   "body": [
    "Market structure — Картата на пазара: swing върхове и дъна, тренд и места за invalidation.",
    "(Избрано според текущата графика.)",
    "Структурата определя тренда.",
    "BOS = продължение."
   ]
  },
  {
   "key": "example",
   "title": "CHART EXAMPLE",
   "body": [
    "Пример от BTC/USDT 1H (последна затворена свещ 2026-10-07 18:00 UTC):",
    "Текущо решение на анализа за BTC/USDT: NO TRADE.",
    "Режим UNCLEAR; структура HH + HL; RSI 60.7; ATR 1.067% от цената."
   ]
  },
  {
   "key": "next_lesson",
   "title": "NEXT LESSON",
   "body": [
    "Прочети целия урок: Market structure → /learn/market-structure",
    "После: Liquidity concepts → /learn/liquidity-concepts"
   ]
  }
 ],
 "follow_ups": [
  {
   "label": "QUIZ ME — провери разбирането",
   "mode": "quiz",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "TEACH ME: Liquidity concepts",
   "mode": "teach",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "topic": "liquidity-concepts"
   }
  },
  {
   "label": "ANALYZE — приложи го върху графиката",
   "mode": "analyze",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  }
 ],
 "context_used": [
  {
   "key": "chart",
   "label": "Графика BTC/USDT 1H",
   "available": true,
   "detail": "DEMO · UNCLEAR · RSI 60.7 · NO TRADE",
   "values": {
    "Последна цена": "106,462.55",
    "Режим": "UNCLEAR",
    "Структура": "HH + HL",
    "RSI(14)": "60.7",
    "ATR%": "1.07%",
    "Обем / ср.": "0.44×"
   }
  },
  {
   "key": "trades",
   "label": "Последни сделки",
   "available": false,
   "detail": "Още няма затворени paper сделки.",
   "values": {}
  },
  {
   "key": "journal",
   "label": "Дневник",
   "available": false,
   "detail": "Дневникът (journal) е празен.",
   "values": {}
  },
  {
   "key": "learning",
   "label": "Академия",
   "available": true,
   "detail": "Ниво 1 · 0/117 урока",
   "values": {
    "Ниво": "1",
    "XP": "0",
    "Уроци": "0/117",
    "Quiz-ове (passed)": "0"
   }
  }
 ],
 "provider": "offline",
 "provider_label": "OFFLINE",
 "fallback": false,
 "llm_rejected_sections": [],
 "disclaimer": "Това е образователен анализ, не финансов съвет. Няма гарантирани резултати в trading-а.",
 "safety_removed": [],
 "safety_note": null,
 "data_available": true,
 "lesson": {
  "slug": "market-structure",
  "title": "Market structure",
  "href": "/learn/market-structure",
  "module": "price_action"
 },
 "next_lesson": {
  "slug": "liquidity-concepts",
  "title": "Liquidity concepts",
  "href": "/learn/liquidity-concepts",
  "module": "price_action"
 },
 "overlay": {
  "support": [
   106484.34,
   105572.05
  ],
  "resistance": [
   107833.53,
   108747.27
  ],
  "swings": [
   {
    "index": 362,
    "time": 1791262800,
    "price": 100488.4,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 367,
    "time": 1791280800,
    "price": 100474.55,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 380,
    "time": 1791327600,
    "price": 110345.78,
    "kind": "high",
    "label": "HH"
   },
   {
    "index": 392,
    "time": 1791370800,
    "price": 103716.82,
    "kind": "low",
    "label": "HL"
   }
  ],
  "setup": {
   "side": "long",
   "entry": 106735.28,
   "stop": 103874.33,
   "target": 107833.53,
   "source": "engine"
  },
  "draft": null
 },
 "session_id": 4,
 "generated_ts": 1791402197
};

export const reviewTradeAnswer: TeacherAnswerData = {
 "mode": "review_trade",
 "title": "REVIEW TRADE",
 "symbol": null,
 "timeframe": null,
 "sections": [
  {
   "key": "what_happened",
   "title": "WHAT HAPPENED",
   "body": [
    "Още нямаш затворена paper сделка за преглед."
   ]
  },
  {
   "key": "did_well",
   "title": "WHAT YOU DID WELL",
   "body": [
    "Няма сделка за оценка — направи първата си paper сделка с stop loss и target."
   ]
  },
  {
   "key": "did_poorly",
   "title": "WHAT TO IMPROVE",
   "body": [
    "Няма данни за грешки."
   ]
  },
  {
   "key": "main_lesson",
   "title": "MAIN LESSON",
   "body": [
    "Добрият процес започва с план: entry, stop (invalidation), target и риск в рамките на правилото ти."
   ]
  }
 ],
 "follow_ups": [
  {
   "label": "TEACH ME: Risk per trade",
   "mode": "teach",
   "payload": {
    "topic": "risk-per-trade"
   }
  }
 ],
 "context_used": [
  {
   "key": "trades",
   "label": "Последни сделки",
   "available": false,
   "detail": "Още няма затворени paper сделки.",
   "values": {}
  },
  {
   "key": "journal",
   "label": "Дневник",
   "available": false,
   "detail": "Дневникът (journal) е празен.",
   "values": {}
  },
  {
   "key": "learning",
   "label": "Академия",
   "available": true,
   "detail": "Ниво 1 · 0/117 урока",
   "values": {
    "Ниво": "1",
    "XP": "0",
    "Уроци": "0/117",
    "Quiz-ове (passed)": "0"
   }
  }
 ],
 "provider": "offline",
 "provider_label": "OFFLINE",
 "fallback": false,
 "llm_rejected_sections": [],
 "disclaimer": "Това е образователен анализ, не финансов съвет. Няма гарантирани резултати в trading-а.",
 "safety_removed": [],
 "safety_note": null,
 "data_available": null,
 "session_id": 7,
 "generated_ts": 1791402197
};

export const whyAnswer: TeacherAnswerData = {
 "mode": "why",
 "title": "WHY? · BTC/USDT 1H",
 "symbol": "BTC/USDT",
 "timeframe": "1h",
 "sections": [
  {
   "key": "why",
   "title": "WHY",
   "body": [
    "Market data: 400 свещи 1h (demo)",
    "Indicators: EMA, RSI 61, MACD, ATR 1,138.95, ADX, VWAP, BB",
    "Market structure: bullish · режим UNCLEAR",
    "Strategy rules: Trend pullback (продължение на uptrend)"
   ]
  },
  {
   "key": "observation",
   "title": "OBSERVATION",
   "body": [
    "BTC/USDT 1H · данни DEMO: последна ЗАТВОРЕНА свещ 2026-10-07 18:00 UTC.",
    "Цена 106,735.28; последна затворена свещ: O 105,575.70 H 106,742.64 L 104,936.27 C 106,735.28.",
    "EMA 20 105,087.91, EMA 50 104,414.37, EMA 200 104,531.63.",
    "RSI(14) 60.7; MACD хистограма -46.80 (расте)."
   ]
  },
  {
   "key": "rules",
   "title": "RULES",
   "body": [
    "Стратегия 'Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)' (по подразбиране — последната ти стратегия):",
    "✗ LONG: EMA(20) (105,087.91) е над EMA(50) (104,414.37), но пресичане нагоре на последната затворена свещ няма → не е изпълнено.",
    "✓ LONG: Close = 106,735.28, EMA(200) = 104,531.63; правилото иска Close над EMA(200) → изпълнено.",
    "✗ SHORT: EMA(20) (105,087.91) е над EMA(50) (104,414.37), но пресичане надолу на последната затворена свещ няма → не е изпълнено."
   ]
  },
  {
   "key": "scenario",
   "title": "SCENARIO",
   "body": [
    "Контекст: режим UNCLEAR (Сигналите не съвпадат (ADX 28, наклон +0.3 ATR, цена над EMA 50).); Higher highs и higher lows — бичя структура (uptrend). Momentum: Weak / mixed.",
    "Стратегията 'Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)': NO SETUP — LONG: изпълнени 1 от 2 условия (нужни са всички условия (AND)). Не е изпълнено: EMA(20) пресича нагоре EMA(50).",
    "Signal engine (общ анализ): NO TRADE — Trend pullback (продължение на uptrend). Хипотеза: движение към 107,833.53 (R:R 0.38), докато 103,874.33 не бъде пробито.",
    "Confidence LOW: Confidence НЕ означава вероятност за печалба — показва само колко фактора съвпадат."
   ]
  },
  {
   "key": "invalidation",
   "title": "INVALIDATION",
   "body": [
    "Engine setup: invalidation 103,874.33. Ако цената падне под 103,874.33, идеята е невалидна (риск 2,860.95 на единица, 2.5 ATR).",
    "Ключови нива: support 106,484.34 и resistance 107,833.53 — затваряне извън тях би променило картината.",
    "Бичата структура (HH + HL) се нарушава при затваряне под последното HL 103,716.82."
   ]
  },
  {
   "key": "risk",
   "title": "RISK",
   "body": [
    "Волатилност High: ATR(14) 1,138.95 = 1.07% от цената (ранг 86/100).",
    "По-висока волатилност → по-широк stop и по-малка позиция при същия риск в пари.",
    "Position sizing по правилото ти 1% риск: equity 10,000.00 → максимален риск 100.00 → размер ≈ 0.03495 единици при stop разстояние 2,860.95.",
    "Рискови фактори от no-trade системата: Poor risk/reward."
   ]
  },
  {
   "key": "alternative",
   "title": "ALTERNATIVE SCENARIO",
   "body": [
    "Алтернативен сценарий: цената пробива 103,874.33 — тогава setup-ът е невалиден и пазарът вероятно продължава в обратна посока или влиза в range.",
    "Ако 'EMA(20) пресича нагоре EMA(50)' се изпълни на следваща затворена свещ (и останалите условия останат), стратегията би показала setup.",
    "Пазарът може да остане и без ясна посока — тогава NO TRADE е валидно решение."
   ]
  },
  {
   "key": "examples",
   "title": "HISTORICAL EXAMPLES",
   "body": [
    "16 исторически примера (бари в режим UNCLEAR с RSI(14) между 60 и 70 (като сега)). След 10 свещи медианното движение е -0.09 ATR (+ = нагоре) (среден 50%: -0.79 … +1.07 ATR); +1R преди −1R: 38%, −1R първо: 50%, нито едно: 12% (1R = 1 ATR(14)). Минали примери (past examples, not a forecast): показват как се е движила цената след подобни условия в историята, не какво ще се случи сега."
   ]
  }
 ],
 "follow_ups": [
  {
   "label": "EXPLAIN — обясни setup-а",
   "mode": "explain",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "ANALYZE — пълен анализ",
   "mode": "analyze",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "TEACH ME: Market structure",
   "mode": "teach",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "topic": "market-structure"
   }
  },
  {
   "label": "QUIZ ME върху тази графика",
   "mode": "quiz",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "COMPARE с 4H",
   "mode": "compare",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "compare_timeframe": "4h"
   }
  }
 ],
 "context_used": [
  {
   "key": "chart",
   "label": "Графика BTC/USDT 1H",
   "available": true,
   "detail": "DEMO · UNCLEAR · RSI 60.7 · NO TRADE",
   "values": {
    "Последна цена": "106,462.55",
    "Режим": "UNCLEAR",
    "Структура": "HH + HL",
    "RSI(14)": "60.7",
    "ATR%": "1.07%",
    "Обем / ср.": "0.44×"
   }
  },
  {
   "key": "strategy",
   "label": "Стратегия: Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)",
   "available": true,
   "detail": "NO SETUP · по подразбиране",
   "values": {
    "Резултат": "NO SETUP",
    "LONG": "1/2 условия",
    "SHORT": "0/2 условия",
    "Regime filter": "OK (UNCLEAR)"
   }
  },
  {
   "key": "historical_examples",
   "label": "Исторически примери",
   "available": true,
   "detail": "16 минали случая — past examples, not a forecast",
   "values": {
    "Случаи": "16",
    "Хоризонт": "10 свещи",
    "Медиана": "-0.09 ATR",
    "+1R първо": "38%",
    "−1R първо": "50%"
   }
  },
  {
   "key": "account",
   "label": "Paper сметка",
   "available": true,
   "detail": "Equity 10,000.00 · 0 отворени позиции",
   "values": {
    "Equity": "10,000.00",
    "Balance": "10,000.00",
    "Free margin": "10,000.00",
    "Отворени позиции": "0",
    "Exposure": "0.00",
    "Риск правило": "1.00%"
   }
  }
 ],
 "provider": "offline",
 "provider_label": "OFFLINE",
 "fallback": false,
 "llm_rejected_sections": [],
 "disclaimer": "This is a rule-based hypothetical setup, not a guarantee of future price movement. Това е образователен анализ, не финансов съвет. Няма гарантирани резултати в trading-а.",
 "safety_removed": [],
 "safety_note": null,
 "data_available": true,
 "examples": {
  "available": true,
  "basis": "analog",
  "horizon": 10,
  "bars_scanned": 940,
  "count": 16,
  "note": "Минали примери (past examples, not a forecast): показват как се е движила цената след подобни условия в историята, не какво ще се случи сега.",
  "regime": "UNCLEAR",
  "rsi_band": [
   60.0,
   70.0
  ],
  "criteria": "бари в режим UNCLEAR с RSI(14) между 60 и 70 (като сега)",
  "r_unit": "1 ATR(14)",
  "direction": "price",
  "median_move_atr": -0.09,
  "p25_move_atr": -0.79,
  "p75_move_atr": 1.07,
  "plus_first_pct": 38,
  "minus_first_pct": 50,
  "neither_pct": 12,
  "reliable": true,
  "summary": "16 исторически примера (бари в режим UNCLEAR с RSI(14) между 60 и 70 (като сега)). След 10 свещи медианното движение е -0.09 ATR (+ = нагоре) (среден 50%: -0.79 … +1.07 ATR); +1R преди −1R: 38%, −1R първо: 50%, нито едно: 12% (1R = 1 ATR(14)). Минали примери (past examples, not a forecast): показват как се е движила цената след подобни условия в историята, не какво ще се случи сега."
 },
 "strategy": {
  "id": 8,
  "name": "Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)",
  "selected": false,
  "source": "recent",
  "result": "NO SETUP"
 },
 "overlay": {
  "support": [
   106484.34,
   105572.05
  ],
  "resistance": [
   107833.53,
   108747.27
  ],
  "swings": [
   {
    "index": 362,
    "time": 1791262800,
    "price": 100488.4,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 367,
    "time": 1791280800,
    "price": 100474.55,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 380,
    "time": 1791327600,
    "price": 110345.78,
    "kind": "high",
    "label": "HH"
   },
   {
    "index": 392,
    "time": 1791370800,
    "price": 103716.82,
    "kind": "low",
    "label": "HL"
   }
  ],
  "setup": {
   "side": "long",
   "entry": 106735.28,
   "stop": 103874.33,
   "target": 107833.53,
   "source": "engine"
  },
  "draft": null
 },
 "session_id": 3,
 "generated_ts": 1791402197
};

export const explainDraftAnswer: TeacherAnswerData = {
 "mode": "explain",
 "title": "EXPLAIN · BTC/USDT 1H",
 "symbol": "BTC/USDT",
 "timeframe": "1h",
 "sections": [
  {
   "key": "draft",
   "title": "YOUR DRAFT ORDER",
   "body": [
    "LONG BTC/USDT @ 106,700.00 · stop 105,000.00 · target 110,000.00",
    "Разстояние до stop: 1,700.00 (1.49 ATR, 1.59% от entry).",
    "✓ Разстоянието до stop е в разумен диапазон спрямо волатилността (0.5–3 ATR).",
    "✓ Stop-ът е под support 106,484.34 — зад нивото, а не в него."
   ]
  },
  {
   "key": "observation",
   "title": "OBSERVATION",
   "body": [
    "BTC/USDT 1H · данни DEMO: последна ЗАТВОРЕНА свещ 2026-10-07 18:00 UTC.",
    "Цена 106,735.28; последна затворена свещ: O 105,575.70 H 106,742.64 L 104,936.27 C 106,735.28.",
    "EMA 20 105,087.91, EMA 50 104,414.37, EMA 200 104,531.63.",
    "RSI(14) 60.7; MACD хистограма -46.80 (расте)."
   ]
  },
  {
   "key": "rules",
   "title": "RULES",
   "body": [
    "Стратегия 'Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)' (по подразбиране — последната ти стратегия):",
    "✗ LONG: EMA(20) (105,087.91) е над EMA(50) (104,414.37), но пресичане нагоре на последната затворена свещ няма → не е изпълнено.",
    "✓ LONG: Close = 106,735.28, EMA(200) = 104,531.63; правилото иска Close над EMA(200) → изпълнено.",
    "✗ SHORT: EMA(20) (105,087.91) е над EMA(50) (104,414.37), но пресичане надолу на последната затворена свещ няма → не е изпълнено."
   ]
  },
  {
   "key": "scenario",
   "title": "SCENARIO",
   "body": [
    "Твоята идея: LONG от 106,700.00 с цел 110,000.00. Тя предполага, че цената ще се движи в твоя полза преди да стигне stop-а — това е хипотеза, не факт.",
    "Контекст: режим UNCLEAR (Сигналите не съвпадат (ADX 28, наклон +0.3 ATR, цена над EMA 50).); Higher highs и higher lows — бичя структура (uptrend). Momentum: Weak / mixed.",
    "Стратегията 'Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)': NO SETUP — LONG: изпълнени 1 от 2 условия (нужни са всички условия (AND)). Не е изпълнено: EMA(20) пресича нагоре EMA(50).",
    "Signal engine (общ анализ): NO TRADE — Trend pullback (продължение на uptrend). Хипотеза: движение към 107,833.53 (R:R 0.38), докато 103,874.33 не бъде пробито."
   ]
  },
  {
   "key": "invalidation",
   "title": "INVALIDATION",
   "body": [
    "Твоята invalidation: 105,000.00. Ако цената стигне там, идеята е грешна — излизаш по план.",
    "Engine setup: invalidation 103,874.33. Ако цената падне под 103,874.33, идеята е невалидна (риск 2,860.95 на единица, 2.5 ATR).",
    "Ключови нива: support 106,484.34 и resistance 107,833.53 — затваряне извън тях би променило картината.",
    "Бичата структура (HH + HL) се нарушава при затваряне под последното HL 103,716.82."
   ]
  },
  {
   "key": "risk",
   "title": "RISK",
   "body": [
    "Position sizing по правилото ти 1% риск: equity 10,000.00 → максимален риск 100.00 → размер ≈ 0.05882 единици при stop разстояние 1,700.00.",
    "Волатилност High: ATR(14) 1,138.95 = 1.07% от цената (ранг 86/100).",
    "По-висока волатилност → по-широк stop и по-малка позиция при същия риск в пари.",
    "Рискови фактори от no-trade системата: Poor risk/reward."
   ]
  },
  {
   "key": "alternative",
   "title": "ALTERNATIVE SCENARIO",
   "body": [
    "Алтернативен сценарий: цената пробива 103,874.33 — тогава setup-ът е невалиден и пазарът вероятно продължава в обратна посока или влиза в range.",
    "Ако 'EMA(20) пресича нагоре EMA(50)' се изпълни на следваща затворена свещ (и останалите условия останат), стратегията би показала setup.",
    "Пазарът може да остане и без ясна посока — тогава NO TRADE е валидно решение."
   ]
  }
 ],
 "follow_ups": [
  {
   "label": "WHY? Защо това решение?",
   "mode": "why",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "TEACH ME: Stop-loss placement",
   "mode": "teach",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "topic": "stop-loss-placement"
   }
  },
  {
   "label": "ANALYZE — пълен анализ",
   "mode": "analyze",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  },
  {
   "label": "TEACH ME: Market structure",
   "mode": "teach",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "topic": "market-structure"
   }
  },
  {
   "label": "QUIZ ME върху тази графика",
   "mode": "quiz",
   "payload": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
   }
  }
 ],
 "context_used": [
  {
   "key": "chart",
   "label": "Графика BTC/USDT 1H",
   "available": true,
   "detail": "DEMO · UNCLEAR · RSI 60.7 · NO TRADE",
   "values": {
    "Последна цена": "106,443.43",
    "Режим": "UNCLEAR",
    "Структура": "HH + HL",
    "RSI(14)": "60.7",
    "ATR%": "1.07%",
    "Обем / ср.": "0.44×"
   }
  },
  {
   "key": "strategy",
   "label": "Стратегия: Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)",
   "available": true,
   "detail": "NO SETUP · по подразбиране",
   "values": {
    "Резултат": "NO SETUP",
    "LONG": "1/2 условия",
    "SHORT": "0/2 условия",
    "Regime filter": "OK (UNCLEAR)"
   }
  },
  {
   "key": "historical_examples",
   "label": "Исторически примери",
   "available": true,
   "detail": "16 минали случая — past examples, not a forecast",
   "values": {
    "Случаи": "16",
    "Хоризонт": "10 свещи",
    "Медиана": "-0.09 ATR",
    "+1R първо": "38%",
    "−1R първо": "50%"
   }
  },
  {
   "key": "account",
   "label": "Paper сметка",
   "available": true,
   "detail": "Equity 10,000.00 · 0 отворени позиции",
   "values": {
    "Equity": "10,000.00",
    "Balance": "10,000.00",
    "Free margin": "10,000.00",
    "Отворени позиции": "0",
    "Exposure": "0.00",
    "Риск правило": "1.00%"
   }
  }
 ],
 "provider": "offline",
 "provider_label": "OFFLINE",
 "fallback": false,
 "llm_rejected_sections": [],
 "disclaimer": "This is a rule-based hypothetical setup, not a guarantee of future price movement. Това е образователен анализ, не финансов съвет. Няма гарантирани резултати в trading-а.",
 "safety_removed": [],
 "safety_note": null,
 "data_available": true,
 "strategy": {
  "id": 8,
  "name": "Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)",
  "selected": false,
  "source": "recent",
  "result": "NO SETUP"
 },
 "overlay": {
  "support": [
   106484.34,
   105572.05
  ],
  "resistance": [
   107833.53,
   108747.27
  ],
  "swings": [
   {
    "index": 362,
    "time": 1791262800,
    "price": 100488.4,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 367,
    "time": 1791280800,
    "price": 100474.55,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 380,
    "time": 1791327600,
    "price": 110345.78,
    "kind": "high",
    "label": "HH"
   },
   {
    "index": 392,
    "time": 1791370800,
    "price": 103716.82,
    "kind": "low",
    "label": "HL"
   }
  ],
  "setup": {
   "side": "long",
   "entry": 106735.28,
   "stop": 103874.33,
   "target": 107833.53,
   "source": "engine"
  },
  "draft": {
   "side": "long",
   "entry": 106700.0,
   "stop": 105000.0,
   "target": 110000.0,
   "risk_per_unit": 1700.0
  }
 },
 "session_id": 9,
 "generated_ts": 1791402197
};

export const strategyView: StrategyViewData = {
 "symbol": "BTC/USDT",
 "timeframe": "1h",
 "strategy": {
  "id": 8,
  "name": "Моята първа стратегия (EMA 20/50 crossover с филтър EMA 200)",
  "is_template": false,
  "selected": false,
  "source": "recent",
  "symbol": "BTC/USDT",
  "timeframe": "4h",
  "summary": [
   "LONG setup: АКО EMA(20) пресича нагоре EMA(50) И Close > EMA(200)",
   "SHORT setup: АКО EMA(20) пресича надолу EMA(50) И Close < EMA(200)",
   "STOP: ATR(14) × 2",
   "TAKE PROFIT: Risk × 2.5",
   "Риск на сделка: 1% от сметката"
  ]
 },
 "closed_candles_only": true,
 "disclaimer": "This is a rule-based hypothetical setup, not a guarantee of future price movement.",
 "available": true,
 "time": 1791396000,
 "price": 106735.28,
 "data_source": "demo",
 "regime": {
  "regime": "UNCLEAR",
  "reasons": [
   "Сигналите не съвпадат (ADX 28, наклон +0.3 ATR, цена над EMA 50)."
  ]
 },
 "structure": {
  "trend": "bullish",
  "text": "Higher highs и higher lows — бичя структура (uptrend).",
  "last_high_label": "HH",
  "last_low_label": "HL",
  "swings": [
   {
    "index": 362,
    "time": 1791262800,
    "price": 100488.4,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 367,
    "time": 1791280800,
    "price": 100474.55,
    "kind": "low",
    "label": "LL"
   },
   {
    "index": 380,
    "time": 1791327600,
    "price": 110345.78,
    "kind": "high",
    "label": "HH"
   },
   {
    "index": 392,
    "time": 1791370800,
    "price": 103716.82,
    "kind": "low",
    "label": "HL"
   }
  ]
 },
 "momentum": {
  "label": "Weak / mixed",
  "rsi": 60.67,
  "macd_hist": -46.8
 },
 "volatility": {
  "label": "High",
  "atr": 1138.95,
  "atr_pct": 1.067,
  "rank": 86
 },
 "support": [
  {
   "price": 106484.34,
   "touches": 2
  },
  {
   "price": 105572.05,
   "touches": 9
  }
 ],
 "resistance": [
  {
   "price": 107833.53,
   "touches": 5
  },
  {
   "price": 108747.27,
   "touches": 4
  }
 ],
 "conditions": {
  "long": [
   {
    "label": "EMA(20) пресича нагоре EMA(50)",
    "passed": false,
    "left_value": 105087.91,
    "right_value": 104414.37,
    "explanation": "EMA(20) (105,087.91) е над EMA(50) (104,414.37), но пресичане нагоре на последната затворена свещ няма → не е изпълнено."
   },
   {
    "label": "Close > EMA(200)",
    "passed": true,
    "left_value": 106735.28,
    "right_value": 104531.63,
    "explanation": "Close = 106,735.28, EMA(200) = 104,531.63; правилото иска Close над EMA(200) → изпълнено."
   }
  ],
  "short": [
   {
    "label": "EMA(20) пресича надолу EMA(50)",
    "passed": false,
    "left_value": 105087.91,
    "right_value": 104414.37,
    "explanation": "EMA(20) (105,087.91) е над EMA(50) (104,414.37), но пресичане надолу на последната затворена свещ няма → не е изпълнено."
   },
   {
    "label": "Close < EMA(200)",
    "passed": false,
    "left_value": 106735.28,
    "right_value": 104531.63,
    "explanation": "Close = 106,735.28, EMA(200) = 104,531.63; правилото иска Close под EMA(200) → не е изпълнено."
   }
  ]
 },
 "logic": {
  "long": "all",
  "short": "all"
 },
 "long_passed": false,
 "short_passed": false,
 "regime_filter": {
  "required": [],
  "actual": "UNCLEAR",
  "passed": true
 },
 "result": "NO SETUP",
 "why": [
  "Оценката е върху последната ЗАТВОРЕНА свещ (2026-10-07 18:00 UTC, close 106,735.28).",
  "LONG: изпълнени 1 от 2 условия (нужни са всички условия (AND)). Не е изпълнено: EMA(20) пресича нагоре EMA(50).",
  "SHORT: изпълнени 0 от 2 условия (нужни са всички условия (AND)). Не е изпълнено: EMA(20) пресича надолу EMA(50); Close < EMA(200).",
  "Regime filter: няма (стратегията търгува във всеки режим); текущ режим UNCLEAR.",
  "Нито LONG, нито SHORT правилата са изпълнени → NO SETUP. Да не търгуваш също е решение."
 ],
 "warnings": [
  {
   "code": "poor_rr",
   "title": "Poor risk/reward",
   "text": "Reward:Risk 0.38 е под минимума 1.5."
  }
 ],
 "risk_plan": null,
 "source": {
  "id": "demo",
  "name": "Demo data (synthetic)",
  "is_live": false,
  "disclaimer": "Синтетични, детерминистично генерирани данни за обучение. Не са реални пазарни цени и не трябва да се използват за реални решения.",
  "status": "demo"
 }
};
