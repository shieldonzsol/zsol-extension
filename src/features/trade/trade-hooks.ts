import type { Address } from "@solana/kit";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { tokenInfo } from "@/features/rings/token-info";

import { readAmount } from "@/features/rings/amount-input";
import { publicMoneyOf, type PublicMoney } from "@/features/rings/sweep";
import { spending, useWallet } from "@/features/wallet/wallet-store";

import {
  quoteTrade,
  searchTokens,
  TradeUnavailable,
  type TradeQuote,
  type TradeRefusal,
  type TradeToken,
} from "./trade-api";
import { mintsInUrl } from "./page-token";
import type { TradeDraft, TradePick } from "./trade-store";

export type LiveQuote =
  | { readonly kind: "none" }
  | { readonly kind: "asking" }
  | { readonly kind: "quoted"; readonly quote: TradeQuote; readonly key: string }
  | { readonly kind: "failed"; readonly code: TradeRefusal | "offline" };

const QUOTE_AFTER_MS = 450;

type Answered<T> = { readonly key: string; readonly result: T };

const failureCode = (error: unknown): TradeRefusal | "offline" =>
  !navigator.onLine ? "offline" : error instanceof TradeUnavailable ? error.code : "unreachable";

/** A quote for what the form holds, asked once typing pauses. */
export function useLiveQuote(site: string, draft: TradeDraft): LiveQuote {
  const [answered, setAnswered] = useState<Answered<
    Extract<LiveQuote, { kind: "quoted" | "failed" }>
  > | null>(null);
  const to = draft.to?.mint ?? null;
  const read = readAmount(draft.amountText, draft.from.decimals);
  const amount = read.ok ? read.amount : null;
  const from = draft.from.mint;
  const key = `${from}|${to ?? ""}|${amount === null ? "" : String(amount)}`;
  useEffect(() => {
    if (to === null || amount === null || to === from) return undefined;
    const asked = `${from}|${to}|${String(amount)}`;
    let alive = true;
    const timer = setTimeout(() => {
      quoteTrade(site, { from, to, amount }).then(
        (quote) => {
          if (alive) setAnswered({ key: asked, result: { kind: "quoted", quote, key: asked } });
        },
        (error: unknown) => {
          if (alive)
            setAnswered({ key: asked, result: { kind: "failed", code: failureCode(error) } });
        },
      );
    }, QUOTE_AFTER_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [site, from, to, amount]);
  if (to === null || amount === null || to === from) return { kind: "none" };
  return answered && answered.key === key ? answered.result : { kind: "asking" };
}

/** What a ghost wallet holds in public, read when it is picked and after each action. */
export function useGhostMoney(address: Address | null): PublicMoney | null {
  const wallet = useWallet();
  const readAt = wallet.kind === "open" ? wallet.readAt : null;
  const [money, setMoney] = useState<{ readonly of: string; readonly money: PublicMoney } | null>(
    null,
  );
  useEffect(() => {
    const open = spending();
    // Read again whenever the wallet is.
    if (!address || !open || readAt === null) return undefined;
    let alive = true;
    publicMoneyOf(open.client, address).then(
      (read) => {
        if (alive) setMoney({ of: address, money: read });
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [address, readAt]);
  return money && money.of === address ? money.money : null;
}

const SEARCH_AFTER_MS = 300;

export type TokenSearch =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "found"; readonly tokens: readonly TradeToken[] }
  | { readonly kind: "failed"; readonly code: TradeRefusal | "offline" };

export function useTokenSearch(site: string, query: string): TokenSearch {
  const [answered, setAnswered] = useState<Answered<
    Extract<TokenSearch, { kind: "found" | "failed" }>
  > | null>(null);
  const asked = query.trim();
  useEffect(() => {
    if (asked.length < 2) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      searchTokens(site, asked).then(
        (tokens) => {
          if (alive) setAnswered({ key: asked, result: { kind: "found", tokens } });
        },
        (error: unknown) => {
          if (alive)
            setAnswered({ key: asked, result: { kind: "failed", code: failureCode(error) } });
        },
      );
    }, SEARCH_AFTER_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [site, asked]);
  if (asked.length < 2) return { kind: "idle" };
  return answered && answered.key === asked ? answered.result : { kind: "searching" };
}

/**
 * The token on the page the panel was opened from, when Chrome lets the panel read its address:
 * read again when another tab comes forward or the page changes.
 */
export function usePageToken(site: string): TradePick | null {
  const [found, setFound] = useState<TradePick | null>(null);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const open = spending();
      const mints = tab?.url && open ? mintsInUrl(tab.url) : [];
      for (const mint of mints) {
        // oxlint-disable-next-line no-await-in-loop -- the first that is a token wins.
        const info = open ? await tokenInfo(site, open.client, mint).catch(() => null) : null;
        if (info) {
          if (alive) setFound({ mint, symbol: info.symbol, decimals: info.decimals });
          return;
        }
      }
      if (alive) setFound(null);
    };
    const onUpdated = (_: number, change: { status?: string }) => {
      if (change.status === "complete") void read();
    };
    const onActivated = () => void read();
    void read();
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      alive = false;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [site]);
  return found;
}
