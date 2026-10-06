import { Globe } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

export default function MarketsPage() {
  return (
    <ComingSoon
      title="Markets"
      subtitle="Пазарен explorer: крипто, акции, ETF, forex, индекси и суровини."
      icon={Globe}
      description="Тук ще разглеждаш стотици инструменти по категории — с търсене, филтри, топ движения и heatmap. Пазарните данни са само за четене; търговията остава виртуална. Междувременно търсенето (клавиш /) вече намира активи."
      planned={["Категории и филтри (клас, сектор, борса)", "Gainers / losers, обем и волатилност", "Heatmap и бърз достъп до графиката"]}
      links={[
        { href: "/charts", label: "Отвори Charts", primary: true },
        { href: "/dashboard", label: "Dashboard" },
      ]}
    />
  );
}
