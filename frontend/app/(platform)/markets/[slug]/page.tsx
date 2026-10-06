import { ChartCandlestick } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

function decode(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export default async function AssetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = decode(slug);
  return (
    <ComingSoon
      title={name}
      subtitle="Страница на актива"
      icon={ChartCandlestick}
      description={`Тук ще има графика, ключови показатели, източник на данните, новини и AI обяснение за ${name}. Липсващите данни ще се показват като DATA NOT AVAILABLE — никога измислени числа.`}
      planned={["Графика с timeframes и индикатори", "Обзор: цена, промяна, обем, източник (LIVE / DEMO)", "AI обяснение и бърз paper trade"]}
      links={[
        { href: "/charts", label: "Отвори Charts", primary: true },
        { href: "/markets", label: "Всички пазари" },
      ]}
    />
  );
}
