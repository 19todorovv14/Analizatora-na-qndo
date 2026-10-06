import { Cpu } from "lucide-react";

import { ComingSoon } from "@/components/shell/ComingSoon";

export default function AiSettingsPage() {
  return (
    <ComingSoon
      title="AI Settings"
      subtitle="Как работи AI Teacher."
      icon={Cpu}
      description="Тук ще избираш AI доставчика и стила на обясненията (кратко / подробно, Beginner / Advanced). AI е образователен: обяснява правила и сценарии и никога не предсказва цени и не казва „купи сега“."
      planned={["Статус на AI доставчика", "Ниво на детайлност на обясненията", "Предпазни правила (без съвети и прогнози)"]}
      links={[
        { href: "/settings", label: "Към Settings", primary: true },
        { href: "/ai", label: "AI Teacher" },
      ]}
    />
  );
}
