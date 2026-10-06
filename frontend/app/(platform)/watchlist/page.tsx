import { Star } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

export default function WatchlistPage() {
  return (
    <ComingSoon
      title="Watchlist"
      subtitle="Активите, които следиш."
      icon={Star}
      description="Тук ще бъде пълният ти списък за наблюдение — цени, промяна, тренд и AI статус, с подреждане и бързо отваряне на графиката. Засега списъкът е в Dashboard."
      planned={["Неограничен списък с подреждане", "Цена, промяна, обем и тренд", "AI статус: setup / wait / no trade"]}
      links={[{ href: "/dashboard", label: "Watchlist в Dashboard", primary: true }]}
    />
  );
}
