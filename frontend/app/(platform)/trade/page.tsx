import { Wallet } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

/* /trade is a full-bleed terminal route (no <main> padding) — the placeholder pads itself. */
export default function TradePage() {
  return (
    <ComingSoon
      padded
      title="Paper Trading"
      subtitle="Paper trading — virtual funds only."
      icon={Wallet}
      description="Тук ще бъде новият paper trading терминал: голяма графика, панел за поръчки, позиции и AI анализ — с виртуални пари и реалистични разходи. Текущият paper trading работи на старата страница."
      planned={["Терминал на цял екран с панели, които се преоразмеряват", "Поръчки с leverage, stop loss и take profit", "Позиции, история и AI преглед на сделката"]}
      links={[{ href: "/paper", label: "Отвори Paper Trading", primary: true }]}
    />
  );
}
