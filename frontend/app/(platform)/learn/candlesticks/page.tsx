import { ChartCandlestick } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

export default function CandlesticksLabPage() {
  return (
    <ComingSoon
      title="Candlestick Lab"
      subtitle="Интерактивна лаборатория за японски свещи."
      icon={ChartCandlestick}
      description="Тук ще строиш свещи от open / high / low / close, ще разпознаваш модели (doji, hammer, engulfing) и ще проверяваш знанията си с упражнения. Дотогава — уроците за свещи в Academy."
      planned={["Candle builder с плъзгане на OHLC", "Разпознаване на модели с обратна връзка", "Упражнения с XP"]}
      links={[
        { href: "/learn/candlestick", label: "Урок: Candlestick", primary: true },
        { href: "/learn", label: "Academy" },
      ]}
    />
  );
}
