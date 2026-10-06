import { Database } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

export default function DataSourcesPage() {
  return (
    <ComingSoon
      title="Data Sources"
      subtitle="Откъде идват пазарните данни."
      icon={Database}
      description="Тук ще виждаш доставчиците на пазарни данни (само за четене), кои инструменти покриват и дали данните са LIVE, DELAYED или DEMO. Когато доставчик не може да даде данни, платформата показва DATA NOT AVAILABLE — никога измислени числа."
      planned={["Статус на всеки доставчик", "Покритие по клас активи", "Ясно маркиране на демо данните"]}
      links={[{ href: "/settings", label: "Към Settings", primary: true }]}
    />
  );
}
