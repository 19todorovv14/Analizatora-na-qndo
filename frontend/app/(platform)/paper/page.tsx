"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Loading } from "@/components/ui";

/** /paper moved to the /trade terminal — client redirect that keeps the query (?symbol=, ?tf=). */
export default function PaperRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/trade${window.location.search}`);
  }, [router]);
  return <Loading text="Paper Trading се отваря в терминала…" />;
}
