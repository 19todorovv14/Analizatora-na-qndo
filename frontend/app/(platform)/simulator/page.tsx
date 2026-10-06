import { Gamepad2 } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

export default function SimulatorPage() {
  return (
    <ComingSoon
      title="Trade Simulator"
      subtitle="Упражнения за вход, stop loss и take profit в контролирани сценарии."
      icon={Gamepad2}
      description="Тук ще тренираш конкретни ситуации (breakout, retest, range) с обратна връзка след всяка сделка. Всичко е виртуално. Дотогава упражнявай в Market Replay и Paper Trading."
      planned={["Сценарии по теми от Academy", "Оценка на входа, риска и изхода", "XP за правилни решения"]}
      links={[
        { href: "/replay", label: "Market Replay", primary: true },
        { href: "/paper", label: "Paper Trading" },
      ]}
    />
  );
}
