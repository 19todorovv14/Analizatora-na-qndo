import type { Metadata, Viewport } from "next";

// Self-hosted variable fonts (bundled from npm — no network at build time). Each package ships
// unicode-range subsets, so Cyrillic and Latin are only downloaded when the page uses them.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

import { SessionProvider } from "@/lib/session";

import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Academy — learn trading without risking real money",
  description:
    "Educational trading platform: interactive lessons, realistic charts, paper trading, AI explanations, strategy testing, risk management and a trading journal. Virtual funds only.",
};

export const viewport: Viewport = {
  themeColor: "#060912",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="bg" className="h-full antialiased">
      <body className="min-h-full">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
