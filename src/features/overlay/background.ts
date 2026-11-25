// The overlay's other half, in the background: it answers a chip only from a site the trader
// allowed, and only while the wallet is open. A click names one of the trader's own buttons; the
// amount, the token and the ghost wallet are read here, the limits checked, and the swap zSol's
// server builds is checked and signed here with the ghost wallet's key.
import {
  createSolanaRpc,
  type Address,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from "@solana/kit";
import { browser, type Browser } from "wxt/browser";

import { authHeaders } from "@/features/auth/auth-source";
import { SendUnanswered, SendUnconfirmed, SponsorRefused } from "@/features/action/send-errors";
import { sponsorSetup } from "@/features/action/sponsor-setup";
import { noteActive, noteBusy, readOpened } from "@/features/lock/vault";
import { formatAmount } from "@/features/rings/amounts";
import { ghostWallet } from "@/features/rings/ghost-keys";
import { publicMoneyOf } from "@/features/rings/public-money";
import { clientName } from "@/features/rings/site-fetch";
import { tokenInfo } from "@/features/rings/token-info";
import { GhostSendRefused, sendFromGhost } from "@/features/trade/ghost-send";
import { mintsInUrl } from "@/features/trade/page-token";
import { prepareGhostSwap, SOL_PICK, type TradePick } from "@/features/trade/trade-model";

import { chipAskOf, OVERLAY_PORT, type ChipNews, type ChipState } from "./protocol";
import { noteSpent, overLimit, readSettings, readSpent } from "./settings";
import { scriptIdOf, siteOfUrl, type OverlaySite } from "./sites";

const CONFIRM_MS = 60_000;

type Client = {
  readonly solanaRpc: Rpc<SolanaRpcApi>;
  confirmTransaction(signature: Signature): Promise<bigint>;
};

class Stop extends Error {
  override readonly name = "Stop";
}

async function confirmed(rpc: Rpc<SolanaRpcApi>, signature: Signature): Promise<bigint> {
  const until = Date.now() + CONFIRM_MS;
  while (Date.now() < until) {
    // oxlint-disable-next-line no-await-in-loop -- one look at a time, until it lands.
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) {
      throw Object.assign(new Error("The swap failed on chain."), {
        details: { reason: "transaction failed" },
      });
    }
    if (status && status.confirmationStatus !== "processed") return status.slot;
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error("Not seen landing yet.");
}

/** Solana through zSol's gateway, with the sign-in the panel last kept. */
async function clientFor(site: string): Promise<Client> {
  const headers = await authHeaders();
  if (!headers) throw new Stop("Open zSol to sign in again, then click once more.");
  const solanaRpc = createSolanaRpc(`${site}/api/rings/solana`, {
    headers: { ...headers, "x-zsol-client": clientName() },
  });
  return { solanaRpc, confirmTransaction: (signature) => confirmed(solanaRpc, signature) };
}

async function allowed(site: OverlaySite): Promise<boolean> {
  const [granted, scripts] = await Promise.all([
    browser.permissions.contains({ origins: [site.pattern] }),
    browser.scripting.getRegisteredContentScripts({ ids: [scriptIdOf(site)] }),
  ]);
  return granted && scripts.length > 0;
}

/** The token the page is about, checked to be one by zSol's token card. */
async function pageToken(site: string, client: Client, url: string): Promise<TradePick | null> {
  for (const mint of mintsInUrl(url)) {
    // oxlint-disable-next-line no-await-in-loop -- the first that is a token wins.
    const info = await tokenInfo(site, client, mint).catch(() => null);
    if (info) return { mint, symbol: info.symbol, decimals: info.decimals };
  }
  return null;
}

async function heldOf(client: Client, owner: Address, mint: string) {
  const money = await publicMoneyOf(client, owner);
  const token = money.tokens.find((each) => each.mint === mint && each.amount > 0n);
  return { lamports: money.lamports, token: token?.amount ?? 0n };
}

async function stateFor(url: string | undefined): Promise<ChipState> {
  const site = siteOfUrl(url);
  if (!site || !url || !(await allowed(site))) return { kind: "off" };
  const opened = await readOpened();
  if (!opened) return { kind: "locked" };
  const settings = await readSettings();
  const client = await clientFor(opened.site).catch(() => null);
  if (!client) return { kind: "locked" };
  const token = await pageToken(opened.site, client, url);
  let sol: string | null = null;
  let held: string | null = null;
  if (settings.showBalances) {
    const ghost = await ghostWallet(opened.seed, settings.ghost);
    const money = await heldOf(client, ghost.address, token?.mint ?? "").catch(() => null);
    if (money) {
      sol = formatAmount(money.lamports, 9);
      held = token ? formatAmount(money.token, token.decimals) : null;
    }
  }
  return {
    kind: "ready",
    token: token ? { mint: token.mint, symbol: token.symbol } : null,
    ghost: settings.ghost,
    sol,
    held,
    buys: settings.buys.map((each) => formatAmount(each, 9)),
    sells: [...settings.sells],
  };
}

const STOP_WORDS: Record<string, string> = {
  short: "The ghost wallet holds less than this takes.",
  "ghost-short": "The ghost wallet needs more SOL: fund it from zSol.",
  route: "Jupiter has no route for this right now.",
  changed: "zSol built a different swap, so it wasn't signed.",
};

async function swapFor(
  url: string | undefined,
  side: "buy" | "sell",
  button: number,
  post: (news: ChipNews) => void,
): Promise<void> {
  const site = siteOfUrl(url);
  if (!site || !url || !(await allowed(site))) throw new Stop("zSol isn't on for this site.");
  const opened = await readOpened();
  if (!opened) throw new Stop("Open zSol and unlock it first.");
  const settings = await readSettings();
  const client = await clientFor(opened.site);
  const token = await pageToken(opened.site, client, url);
  if (!token) throw new Stop("Open a token's page to trade it.");
  const ghost = await ghostWallet(opened.seed, settings.ghost);
  let amount: bigint;
  let from: TradePick;
  let to: TradePick;
  if (side === "buy") {
    const preset = settings.buys[button];
    if (preset === undefined) throw new Stop("That button has no amount.");
    const limit = overLimit(settings, preset, await readSpent());
    if (limit) {
      throw new Stop(
        limit === "per-click"
          ? "That's more than one click may spend. Raise it in zSol, or trade there."
          : "Today's one-click limit is spent. Raise it in zSol, or trade there.",
      );
    }
    amount = preset;
    from = SOL_PICK;
    to = token;
  } else {
    const share = settings.sells[button];
    if (share === undefined) throw new Stop("That button has no share.");
    const { token: held } = await heldOf(client, ghost.address, token.mint);
    if (held === 0n)
      throw new Stop(`Ghost ${String(settings.ghost + 1)} holds no ${token.symbol}.`);
    amount = share >= 100 ? held : (held * BigInt(share)) / 100n;
    from = token;
    to = SOL_PICK;
  }
  await Promise.all([noteActive(), noteBusy(true)]);
  try {
    post({ news: "step", words: "Preparing the swap…" });
    const fees = await sponsorSetup(opened.site);
    const prepared = await prepareGhostSwap(
      {
        source: { kind: "ghost", index: settings.ghost, address: ghost.address },
        from,
        to,
        amountText: "",
        slippageBps: settings.slippageBps,
      },
      { kind: "ghost", index: settings.ghost, address: ghost.address },
      amount,
      { open: { site: opened.site, client }, fees },
    );
    if ("problem" in prepared) {
      throw new Stop(STOP_WORDS[prepared.problem.kind] ?? "It can't go by one click now.");
    }
    const signature = await sendFromGhost({
      client,
      keys: ghost.keys,
      transaction: prepared.review.transaction,
      hooks: {
        onStep: (step) =>
          post({
            news: "step",
            words: step === "confirming" ? "Waiting for it to land…" : "Signing and sending…",
          }),
        onSigned: () => undefined,
        onSent: () => undefined,
      },
    });
    if (side === "buy") await noteSpent(amount);
    post({
      news: "done",
      words: `Got at least ${formatAmount(prepared.review.minOut, to.decimals)} ${to.symbol}.`,
      link: `${opened.site}/tx/${signature}`,
    });
  } finally {
    await noteBusy(false);
  }
}

function stoppedWords(error: unknown): string {
  if (error instanceof Stop) return error.message;
  if (error instanceof GhostSendRefused)
    return "Solana refused it before it went out. Nothing moved.";
  if (error instanceof SendUnconfirmed)
    return "Sent, not seen landing yet. Check zSol before you click again.";
  if (error instanceof SendUnanswered)
    return "It may have gone through. Check zSol before you click again.";
  if (error instanceof SponsorRefused && error.code === "signed-out") {
    return "Open zSol to sign in again, then click once more.";
  }
  return "It didn't go through. Nothing moved.";
}

/** The page's own address now: a terminal moves between tokens without loading a page. */
async function urlOf(sender: Browser.runtime.MessageSender): Promise<string | undefined> {
  const id = sender.tab?.id;
  if (id === undefined) return undefined;
  return (await browser.tabs.get(id).catch(() => null))?.url ?? sender.url;
}

export function listenForChips(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== OVERLAY_PORT) return;
    const sender = port.sender;
    if (sender?.id !== browser.runtime.id || !sender.tab || sender.frameId !== 0) {
      port.disconnect();
      return;
    }
    let swapping = false;
    const post = (news: ChipNews) => {
      try {
        port.postMessage(news);
      } catch {
        // The tab closed: nothing to tell.
      }
    };
    port.onMessage.addListener((raw: unknown) => {
      const ask = chipAskOf(raw);
      if (!ask) return;
      void urlOf(sender).then(async (url) => {
        if (ask.ask === "state") {
          post({
            news: "state",
            state: await stateFor(url).catch(() => ({ kind: "locked" }) as const),
          });
          return;
        }
        if (swapping) return;
        swapping = true;
        try {
          await swapFor(url, ask.side, ask.button, post);
        } catch (error) {
          post({ news: "stopped", words: stoppedWords(error) });
        } finally {
          swapping = false;
        }
      });
    });
  });
}
