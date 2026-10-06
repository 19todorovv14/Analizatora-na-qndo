"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, ErrorText, Field, Tabs } from "@/components/ui";
import { errorMessage, post } from "@/lib/api";
import { startGuest, useSession } from "@/lib/session";

export default function LoginPage() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === "login") await post("/auth/login", { email, password });
      else await post("/auth/register", { email, password, display_name: name || "Trader" });
      await refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const guest = async () => {
    setBusy(true);
    try {
      await startGuest();
      await refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-white">TA</span>
          Trading Academy
        </Link>
        <div className="card p-5">
          <Tabs
            tabs={[
              { key: "login", label: "Вход" },
              { key: "register", label: "Регистрация" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <form onSubmit={submit} className="mt-4 space-y-3">
            {tab === "register" && (
              <Field label="Име">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Trader" />
              </Field>
            )}
            <Field label="Email">
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Парола" hint={tab === "register" ? "Поне 8 символа, малки и главни букви и цифра." : undefined}>
              <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <ErrorText error={error} />
            <Button className="w-full" disabled={busy}>
              {tab === "login" ? "Влез" : "Създай акаунт"}
            </Button>
          </form>
          <div className="my-4 flex items-center gap-2 text-xs text-faint">
            <span className="h-px flex-1 bg-line" /> или <span className="h-px flex-1 bg-line" />
          </div>
          <Button variant="outline" className="w-full" onClick={guest} disabled={busy}>
            Опитай веднага като гост (демо профил)
          </Button>
          <p className="mt-4 text-center text-xs text-muted">
            Демо акаунт: <span className="num">demo@trading-academy.local</span> / <span className="num">Demo12345</span>
          </p>
        </div>
        <p className="mt-4 text-center text-[11px] text-faint">Само виртуални средства. Не съхраняваме платежни данни или ключове.</p>
      </div>
    </main>
  );
}
