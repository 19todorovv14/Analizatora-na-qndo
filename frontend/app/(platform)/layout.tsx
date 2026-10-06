import { AppShell } from "@/components/shell/AppShell";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
