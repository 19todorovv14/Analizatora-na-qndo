import { Waypoints } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

export default function MarketStructureLabPage() {
  return (
    <ComingSoon
      title="Market Structure Lab"
      subtitle="Тренд, swing точки, support и resistance."
      icon={Waypoints}
      description="Тук ще маркираш higher highs / higher lows, ще откриваш break of structure и ще упражняваш breakout и retest върху реални исторически графики. Дотогава — уроците в Academy."
      planned={["Маркиране на HH / HL / LH / LL", "Support, resistance и пробиви", "Упражнения с обратна връзка"]}
      links={[
        { href: "/learn", label: "Academy", primary: true },
        { href: "/learn/trend", label: "Урок: Trend" },
      ]}
    />
  );
}
