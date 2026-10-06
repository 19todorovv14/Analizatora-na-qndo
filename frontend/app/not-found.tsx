import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-center">
      <h1 className="text-2xl font-bold">404 — страницата не е намерена</h1>
      <Link href="/dashboard" className="text-accent2 hover:underline">
        Към Dashboard →
      </Link>
    </main>
  );
}
