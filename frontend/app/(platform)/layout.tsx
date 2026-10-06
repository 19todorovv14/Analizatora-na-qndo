import { AppShell } from "@/components/shell/AppShell";
import { PlatformProviders } from "@/components/shell/Providers";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlatformProviders>
      <AppShell>{children}</AppShell>
    </PlatformProviders>
  );
}
