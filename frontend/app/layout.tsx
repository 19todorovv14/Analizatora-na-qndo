import type { Metadata } from "next";

import { SessionProvider } from "@/lib/session";

import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Academy — learn trading without risking real money",
  description:
    "Educational trading platform: interactive lessons, realistic charts, paper trading, AI explanations, strategy testing, risk management and a trading journal. Virtual funds only.",
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
