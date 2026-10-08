"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { INITIAL_TICKET, requestKey, ticketReducer, type OrderRequest, type TicketAction, type TicketState } from "@/components/trading/ticket";
import { errorMessage, post } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import type { OrderPreview } from "@/lib/types";

export type OrderTicket = {
  symbol: string;
  state: TicketState;
  dispatch: (a: TicketAction) => void;
};

/**
 * Order-ticket state owned by a terminal page, so the chart (draft lines, click-to-set), the order panel
 * and the AI panel share one draft. Switching the instrument drops the price levels / quantity / leverage.
 */
export function useOrderTicket(symbol: string, initial: TicketState = INITIAL_TICKET): OrderTicket {
  const [store, setStore] = useState<{ symbol: string; state: TicketState }>({ symbol, state: initial });
  // derive-on-change (no effect): a new instrument resets the levels during render
  let current = store;
  if (store.symbol !== symbol) {
    current = { symbol, state: ticketReducer(store.state, { type: "instrument" }) };
    setStore(current);
  }
  const dispatch = useCallback(
    (a: TicketAction) =>
      setStore((prev) => {
        const next = ticketReducer(prev.state, a);
        return next === prev.state ? prev : { ...prev, state: next };
      }),
    [],
  );
  return { symbol, state: current.state, dispatch };
}

export type PreviewState = {
  preview: OrderPreview | null;
  error: string | null;
  loading: boolean;
};

/**
 * Debounced POST /paper/orders/preview for the current request. Only the answer for the LATEST request is
 * kept (late responses of older drafts are dropped); `null` request → nothing shown.
 */
export function useOrderPreview(request: OrderRequest | null, delayMs = 450): PreviewState {
  const key = requestKey(request);
  const debouncedKey = useDebounced(key, delayMs);
  const [result, setResult] = useState<{ key: string; preview: OrderPreview | null; error: string | null } | null>(null);
  // the request object of the debounced key (requests are rebuilt every render; the key identifies them)
  const pending = useMemo(() => (debouncedKey && debouncedKey === key ? request : null), [debouncedKey, key, request]);
  const pendingKey = pending ? key : "";

  useEffect(() => {
    if (!pending || !pendingKey) return;
    let cancelled = false;
    post<OrderPreview>("/paper/orders/preview", pending)
      .then((p) => !cancelled && setResult({ key: pendingKey, preview: p, error: null }))
      .catch((e) => !cancelled && setResult({ key: pendingKey, preview: null, error: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
    // `pending` changes identity every render; the key is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const fresh = !!key && result?.key === key;
  return {
    preview: fresh ? result.preview : null,
    error: fresh ? result.error : null,
    loading: !!key && !fresh,
  };
}
