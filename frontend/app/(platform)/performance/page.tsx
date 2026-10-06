import { ChartNoAxesCombined } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

export default function PerformancePage() {
  return (
    <ComingSoon
      title="Performance"
      subtitle="Как се представят твоите paper сделки във времето."
      icon={ChartNoAxesCombined}
      description="Тук ще има equity крива, drawdown, разбивка по setup, актив и timeframe и сравнение с buy & hold. Част от тези метрики вече са в Statistics."
      planned={["Equity крива и drawdown", "Резултати по setup, актив и час", "Expectancy, profit factor и R-разпределение"]}
      links={[{ href: "/stats", label: "Отвори Statistics", primary: true }]}
    />
  );
}
