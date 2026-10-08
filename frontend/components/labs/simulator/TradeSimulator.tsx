"use client";

/*
 * /simulator — TRADE SIMULATOR (what-if, no order). Pick an instrument (S1 AssetSearchCombobox), side, entry (the
 * executable price when the instrument loaded: ask for a long, bid for a short), stop, target, risk % or position
 * size and a leverage capped at the instrument's maximum. Fees, spread, daily volatility and the FX rate come from
 * GET /paper/instrument; the maths from POST /learn/leverage/simulate (prices converted to USD with the quote
 * currency's rate, so money is in the account currency for every instrument). Nothing reaches the paper broker.
 */
import { ArrowUpRight, BookOpen, Calculator, Crosshair, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";

import { linkButton } from "@/components/learn/linkButton";
import {
  allowedLeverages,
  effectiveLeverage,
  exampleLevels,
  marketPrice,
  parseNum,
  planError,
  rescaleResult,
  tradeHref,
  tradeRequest,
} from "@/components/labs/model";
import { SimulatorResults } from "@/components/labs/simulator/SimulatorResults";
import type { LeverageResult, Side } from "@/components/labs/types";
import { SIMULATE_PATH } from "@/components/labs/useLeverageSim";
import { AssetSearchCombobox } from "@/components/market";
import {
  Badge,
  Card,
  DataNotAvailable,
  Disclaimer,
  EmptyState,
  ErrorState,
  ErrorText,
  Notice,
  PageHeader,
  Segmented,
  Skeleton,
  SkeletonText,
  SourceBadge,
  Term,
} from "@/components/ui";
import { errorMessage, errorReason, isDataNotAvailable, post } from "@/lib/api";
import { fmtPrice } from "@/lib/format";
import { useDebounced, usePaperInstrument } from "@/lib/hooks";
import { useSession } from "@/lib/session";

const EQUITY = 10_000;

type Sizing = "risk" | "notional";
type PlanText = { key: string; entry: string; stop: string; target: string };
type SimOut = { res: LeverageResult; symbol: string; rate: number };

/** The result carries the symbol and FX rate it was computed with, so a result kept on screen while the next one
 *  loads is never re-scaled with another instrument's rate. */
const simFetcher = async ([path, payload]: [string, string]): Promise<SimOut> => {
  const { body, symbol, rate } = JSON.parse(payload) as { body: unknown; symbol: string; rate: number };
  return { res: await post<LeverageResult>(path, body), symbol, rate };
};

function NumInput({ label, term, value, onChange, placeholder, invalid }: { label: string; term?: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="label">{term ? <Term k={term}>{label}</Term> : label}</span>
      <input className="input num" inputMode="decimal" value={value} placeholder={placeholder} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function TradeSimulator() {
  const { beginner } = useSession();
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [side, setSide] = useState<Side>("long");
  const [plan, setPlan] = useState<PlanText | null>(null);
  const [anchor, setAnchor] = useState<{ key: string; price: number } | null>(null);
  const [sizing, setSizing] = useState<Sizing>("risk");
  const [riskText, setRiskText] = useState("1");
  const [notionalText, setNotionalText] = useState("1000");
  const [leverage, setLeverage] = useState(1);

  // deep link: /simulator?symbol=ETH/USDT (read once on mount, like the other pages)
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("symbol");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time prefill from the deep link
    if (s) setSymbol(s);
  }, []);

  const { data: instData, error: instError, isLoading: instLoading, mutate: reloadInst } = usePaperInstrument(symbol);
  const inst = instData && !instLoading ? instData : null; // never mix the previous instrument into a new symbol
  const prec = inst?.price_precision ?? 2;
  const live = inst?.available ? marketPrice(inst, side) : null;
  const planKey = `${inst?.symbol ?? symbol}|${side}`;

  // The plan's reference price is frozen per instrument + side (the live quote keeps ticking next to it).
  if (live !== null && anchor?.key !== planKey) setAnchor({ key: planKey, price: live });
  const refPrice = anchor?.key === planKey ? anchor.price : live;
  const dailyPct = inst ? inst.daily_vol * 100 : null;
  const examples = refPrice ? exampleLevels(refPrice, side, dailyPct, prec) : null;

  const edited = plan?.key === planKey ? plan : null;
  const entryText = edited?.entry ?? (refPrice ? refPrice.toFixed(prec) : "");
  const stopText = edited?.stop ?? (examples ? examples.stop.toFixed(prec) : "");
  const targetText = edited?.target ?? (examples ? examples.target.toFixed(prec) : "");
  const edit = (field: "entry" | "stop" | "target", v: string) =>
    setPlan({ key: planKey, entry: entryText, stop: stopText, target: targetText, [field]: v });

  const entry = parseNum(entryText);
  const stop = parseNum(stopText);
  const target = parseNum(targetText);
  const riskPct = parseNum(riskText);
  const notional = parseNum(notionalText);
  const chips = allowedLeverages(inst?.max_leverage);
  const lev = effectiveLeverage(leverage, chips);
  const rate = inst?.conversion?.rate ?? null;

  const entryErr = entry === null ? (inst && !inst.available ? "Няма текуща цена — въведи цена на влизане ръчно." : null) : entry > 0 ? null : "Цената на влизане трябва да е положителна.";
  const pErr = entry !== null && entry > 0 ? planError(side, entry, stop, target) : null;
  const sizeErr =
    sizing === "risk"
      ? riskPct === null || !(riskPct > 0) || riskPct > 100
        ? "Риск % трябва да е между 0 и 100."
        : stop === null
          ? "За размер по риск е нужен stop loss."
          : null
      : notional === null || !(notional > 0)
        ? "Въведи размер на позицията в USD."
        : null;
  const rateErr = inst && inst.conversion && !inst.conversion.available ? (inst.conversion.reason ?? `Няма курс ${inst.quote_currency} → USD.`) : null;

  const body =
    inst && entry !== null && entry > 0 && rate && !pErr && !sizeErr
      ? tradeRequest({
          side,
          entry,
          stop,
          target,
          leverage: lev,
          sizing,
          riskPct,
          notional,
          rate,
          feeRate: inst.taker_fee,
          spreadBps: inst.spread_bps,
          dailyVolPct: dailyPct,
          equity: EQUITY,
        })
      : null;
  const payload = body && inst ? JSON.stringify({ body, symbol: inst.symbol, rate }) : null;
  const dPayload = useDebounced(payload, 300);
  const sim = useSWR<SimOut, unknown, [string, string] | null>(dPayload ? [SIMULATE_PATH, dPayload] : null, simFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
    dedupingInterval: 60_000,
  });
  const out = body && sim.data && inst && sim.data.symbol === inst.symbol ? sim.data : null;
  const res = out ? rescaleResult(out.res, out.rate) : null;
  const stale = payload !== dPayload || sim.isValidating;
  const quote = inst?.quote_currency ?? "";
  const base = inst ? (inst.symbol.includes("/") ? inst.symbol.split("/")[0] : inst.symbol) : "";
  const formError = entryErr ?? pErr ?? sizeErr ?? rateErr;

  /* ── form ─────────────────────────────────────────────────── */
  let quoteBlock: React.ReactNode;
  if (instError && !instData) {
    quoteBlock = isDataNotAvailable(instError) ? (
      <DataNotAvailable compact reason={errorReason(instError)} />
    ) : (
      <ErrorState title="Инструментът не се зареди" description={errorReason(instError)} onRetry={() => reloadInst()} />
    );
  } else if (!inst) {
    quoteBlock = <Skeleton className="h-[74px] w-full" />;
  } else if (!inst.available) {
    quoteBlock = <DataNotAvailable compact reason={inst.unavailable_reason ?? undefined} />;
  } else {
    quoteBlock = (
      <div className="glass-inset space-y-2 px-3 py-2.5">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted">
              <Term k="bid">Bid</Term>
            </div>
            <div className="num text-sm font-semibold text-text">{fmtPrice(inst.bid, prec)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted">
              <Term k="ask">Ask</Term>
            </div>
            <div className="num text-sm font-semibold text-text">{fmtPrice(inst.ask, prec)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted">Макс. leverage</div>
            <div className="num text-sm font-semibold text-text">{inst.max_leverage}x</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          <span className="min-w-0 truncate">{inst.name}</span>
          <span aria-hidden>·</span>
          <span>котировка в {quote}</span>
          <span aria-hidden>·</span>
          <span>~{dailyPct?.toFixed(1)}% дневно движение</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Calculator}
        title="Trade Simulator"
        subtitle="What-if за една сделка: размер, margin, R:R, P/L при stop и target, ликвидация и разходи. Без поръчка — нищо не се изпраща към брокера."
        actions={
          <>
            <Link href="/learn/leverage" className={linkButton("outline")}>
              <BookOpen size={15} aria-hidden /> Leverage Academy
            </Link>
            <Link href={`/trade?symbol=${encodeURIComponent(inst?.symbol ?? symbol)}`} className={linkButton("outline")}>
              <Crosshair size={15} aria-hidden /> Paper Trading
            </Link>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card
          title="Сделка"
          right={
            inst ? (
              <span className="flex items-center gap-1.5">
                {inst.market_status && inst.market_status.status !== "open" && <Badge tone="warn">{inst.market_status.label ?? "затворен"}</Badge>}
                <SourceBadge source={inst.source} />
              </span>
            ) : undefined
          }
          className="self-start"
        >
          <div className="space-y-4">
            <div>
              <span className="label">Инструмент</span>
              <AssetSearchCombobox
                value={symbol}
                onChange={(s) => {
                  if (s && s !== symbol) setSymbol(s);
                }}
                ariaLabel="Инструмент"
                className="w-full"
              />
            </div>

            {quoteBlock}

            {inst?.market_status && inst.market_status.status !== "open" && (
              <Notice tone="info">
                {inst.market_status.label ?? "Пазарът е затворен"}: пазарна поръчка в paper се изпълнява на последната цена от доставчика.
                {inst.market_status.note ? ` ${inst.market_status.note}` : ""}
              </Notice>
            )}

            <div>
              <span className="label">Посока</span>
              <Segmented<Side>
                fullWidth
                options={[
                  {
                    value: "long",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <TrendingUp size={14} aria-hidden /> Long
                      </span>
                    ),
                  },
                  {
                    value: "short",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <TrendingDown size={14} aria-hidden /> Short
                      </span>
                    ),
                  },
                ]}
                value={side}
                onChange={setSide}
                ariaLabel="Посока"
              />
            </div>

            <div>
              <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
                <NumInput label={`Вход${quote ? ` (${quote})` : ""}`} value={entryText} onChange={(v) => edit("entry", v)} invalid={!!entryErr} />
                <NumInput label="Stop loss" term="stoploss" value={stopText} onChange={(v) => edit("stop", v)} placeholder="няма" invalid={!!pErr && stop !== null} />
                <NumInput label="Take profit" term="takeprofit" value={targetText} onChange={(v) => edit("target", v)} placeholder="няма" invalid={!!pErr && target !== null} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={live === null}
                  onClick={() => live !== null && edit("entry", live.toFixed(prec))}
                  className={linkButton("ghost", "sm", "disabled:pointer-events-none disabled:opacity-40")}
                >
                  <Crosshair size={13} aria-hidden /> Текуща цена{live !== null ? ` ${fmtPrice(live, prec)}` : ""}
                </button>
                <button
                  type="button"
                  disabled={!edited}
                  onClick={() => {
                    setPlan(null);
                    setAnchor(null);
                  }}
                  className={linkButton("ghost", "sm", "disabled:pointer-events-none disabled:opacity-40")}
                >
                  <RotateCcw size={13} aria-hidden /> Примерни нива
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                Примерните нива са на 1 (stop) и 2 (target) типични дневни движения от входа — само за илюстрация, не са препоръка. Смени ги с твоите.
              </p>
            </div>

            <div>
              <Segmented<Sizing>
                size="sm"
                fullWidth
                options={[
                  { value: "risk", label: "Риск % от сметката" },
                  { value: "notional", label: "Размер в USD" },
                ]}
                value={sizing}
                onChange={setSizing}
                ariaLabel="Как се определя размерът"
              />
              <label className="relative mt-2 block">
                <span className="sr-only">{sizing === "risk" ? "Риск в % от сметката" : "Размер на позицията в USD"}</span>
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>
                  {sizing === "risk" ? "%" : "$"}
                </span>
                <input
                  className="input num pl-7"
                  inputMode="decimal"
                  value={sizing === "risk" ? riskText : notionalText}
                  onChange={(e) => (sizing === "risk" ? setRiskText(e.target.value) : setNotionalText(e.target.value))}
                  aria-invalid={!!sizeErr || undefined}
                />
              </label>
              <p className="mt-1 text-[11px] leading-relaxed text-faint">
                {sizing === "risk"
                  ? `Колко губиш при stop loss (с разходите), като % от виртуалните ${EQUITY.toLocaleString("en-US")} USD.`
                  : "Стойността на позицията (notional) в USD."}
              </p>
            </div>

            <div>
              <span className="label">
                <Term k="leverage">Leverage</Term>
              </span>
              <Segmented<number> fullWidth={chips.length > 3} options={chips.map((l) => ({ value: l, label: `${l}x` }))} value={lev} onChange={setLeverage} ariaLabel="Leverage" />
              <p className="mt-1 text-[11px] leading-relaxed text-faint">
                {inst ? `До ${inst.max_leverage}x за ${inst.symbol}. ` : ""}
                {sizing === "risk"
                  ? "При размер по риск leverage-ът не променя загубата до stop-а — променя margin-а и ликвидацията."
                  : "Leverage-ът сменя блокирания margin и разстоянието до ликвидация."}
              </p>
            </div>

            {inst && (
              <p className="text-[11px] text-muted">
                Разходи по спецификацията: <Term k="fees">taker fee</Term> {(inst.taker_fee * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}% ·{" "}
                <Term k="spread">spread</Term> {inst.spread_bps} bps
              </p>
            )}

            <ErrorText error={formError} />

            <div className="space-y-1.5 border-t border-white/[0.06] pt-3">
              <Link
                href={tradeHref({ symbol: inst?.symbol ?? symbol, side, entry, stop, target, leverage: lev })}
                className={linkButton("primary", "md", "w-full")}
              >
                Отвори в Paper Trading <ArrowUpRight size={15} aria-hidden />
              </Link>
              <p className="text-center text-[11px] text-faint">Отваря терминала с {inst?.symbol ?? symbol}. Поръчката пускаш ти — тук нищо не се изпраща.</p>
            </div>
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          {sim.error && body ? <ErrorText error={errorMessage(sim.error)} /> : null}
          {res && inst ? (
            <SimulatorResults
              res={res}
              precision={prec}
              base={base}
              quote={quote}
              beginner={beginner}
              stale={stale}
              convertedNote={out && out.rate !== 1 ? `Цените в тези стъпки са превалутирани в USD по курс ${out.rate} USD за 1 ${quote}.` : null}
            />
          ) : body || (!inst && !instError) ? (
            <Card>
              <SkeletonText lines={6} />
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={Calculator}
                title="Попълни сделката"
                description={formError ?? "Избери инструмент, посока, вход, stop loss и размер — резултатът се смята веднага."}
                compact
              />
            </Card>
          )}
          <Disclaimer>
            Симулация с виртуална сметка от $10,000 по правилата на paper брокера (cross margin, stop-out при 50% margin level, такси и spread на
            инструмента). Не е поръчка и не е съвет; slippage и funding не са включени. Higher leverage magnifies exposure and liquidation risk.
          </Disclaimer>
        </div>
      </div>
    </div>
  );
}
