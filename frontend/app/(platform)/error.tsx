"use client";

import Link from "next/link";
import { useEffect } from "react";

import { ErrorState } from "@/components/ui";

/**
 * Error boundary for every platform page (the shell stays usable). Next 16.3 passes `retry`
 * (re-fetch + re-render the segment); `reset` is kept as a fallback for older runtimes.
 */
export default function PlatformError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-10">
      <ErrorState
        className="w-full"
        title="Тази страница не успя да се зареди"
        description={
          <>
            Възникна неочаквана грешка. Опитай отново — ако проблемът остане, презареди страницата.
            {error.digest && <span className="mt-1 block text-[11px] text-faint">Код: {error.digest}</span>}
          </>
        }
        onRetry={() => (retry ?? reset)?.()}
      />
      <Link href="/dashboard" className="text-xs font-medium text-accent2 transition-colors hover:text-text">
        Към Dashboard →
      </Link>
    </div>
  );
}
