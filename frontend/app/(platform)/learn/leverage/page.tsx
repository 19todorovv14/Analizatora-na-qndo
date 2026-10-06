import { Scale } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

export default function LeverageLabPage() {
  return (
    <ComingSoon
      title="Leverage Lab"
      subtitle="Как leverage променя margin, риска и ликвидацията."
      icon={Scale}
      description="Тук ще симулираш една и съща сделка с различен leverage и ще виждаш margin, ликвидационна цена и загубата при stop loss — с виртуални пари. Целта е да разбереш риска, не да използваш leverage."
      planned={["Плъзгач за leverage с ликвидационна цена", "Margin, free margin и margin level", "Сравнение: риск при 1x срещу 10x"]}
      links={[
        { href: "/learn", label: "Academy", primary: true },
        { href: "/risk", label: "Risk Management" },
      ]}
    />
  );
}
