import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { browser } from "wxt/browser";

import { placeHref } from "@/app/places";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  Heading,
  NotOpenYet,
  PlaceLink,
  ProblemLine,
  Sending,
} from "@/features/action/parts";
import { FAILURE_WORDS } from "@/features/action/words";
import { OrderId } from "@/features/orders/order-tracker";
import { codeInText } from "@/features/rings/links";
import { useWallet } from "@/features/wallet/wallet-store";

import { ClaimWords, MovedLine } from "./link-words";
import {
  amountsText,
  claimIt,
  clearClaim,
  openClaim,
  useLinks,
  type ClaimView,
} from "./links-store";

/** A Dark link open in the tab the panel was opened from, when Chrome lets the panel read it. */
function useTabLink(site: string): string | null {
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      let code: string | null = null;
      try {
        const url = tab?.url ? new URL(tab.url) : null;
        if (url && url.origin === site && url.pathname === "/claim") code = codeInText(url.hash);
      } catch {
        code = null;
      }
      if (alive) setFound(code);
    };
    void read();
    const onChange = () => void read();
    browser.tabs.onActivated.addListener(onChange);
    browser.tabs.onUpdated.addListener(onChange);
    return () => {
      alive = false;
      browser.tabs.onActivated.removeListener(onChange);
      browser.tabs.onUpdated.removeListener(onChange);
    };
  }, [site]);
  return found;
}

export function ClaimPlace({ site }: { readonly site: string }) {
  const wallet = useWallet();
  const { claim } = useLinks();
  return (
    <div className="flex flex-col gap-4 p-4">
      <a
        href={placeHref("wallet")}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 self-start" })}
      >
        <ArrowLeftIcon data-icon="inline-start" strokeWidth={1.75} />
        Wallet
      </a>
      <Heading
        title="Claim a Dark link"
        body="Paste a Dark link someone sent you. Its money moves into your private balance, free: the sender paid zSol's fee."
      />
      {wallet.kind !== "open" || wallet.balances === null ? (
        <NotOpenYet what="Claim" />
      ) : (
        <Stage claim={claim} site={site} />
      )}
    </div>
  );
}

function Stage({ claim, site }: { readonly claim: ClaimView; readonly site: string }) {
  if (claim.kind === "idle" || claim.kind === "broken") {
    return <LinkForm broken={claim.kind === "broken"} site={site} />;
  }
  if (claim.kind === "reading") {
    return (
      <Card>
        <output className="block text-sm text-muted-foreground">Opening the link…</output>
      </Card>
    );
  }
  if (claim.kind === "unread") {
    return (
      <Card>
        <ProblemLine
          text="This link couldn't be read just now."
          next="The link looks whole: reading it from Solana failed. Try again in a moment."
        />
        <span className="flex gap-2">
          <Again code={claim.code} />
          <Different />
        </span>
      </Card>
    );
  }
  if (claim.kind === "empty") {
    return (
      <Card>
        <p className="text-sm font-medium">Nothing is in this link right now.</p>
        <p className="text-label text-pretty text-muted-foreground">
          If it was sent by Ghost Route, its money lands a while after the link was made: check
          again then. If you claimed it, it's in your private balance already. If it was taken back,
          ask the sender for a new link.
        </p>
        <span className="flex gap-2">
          <Again code={claim.code} label="Check again" />
          <Different />
        </span>
      </Card>
    );
  }
  if (claim.kind === "moving") {
    return (
      <div className="flex flex-col gap-3">
        <Sending order={claim.order} site={site} />
        <output className="block px-1 text-label text-pretty text-muted-foreground">
          <ClaimWords progress={claim.progress} />
        </output>
      </div>
    );
  }
  if (claim.kind === "ready") return <Ready holdings={amountsText(claim.holdings)} />;
  const { outcome } = claim;
  if (outcome.kind === "moved") {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <output className="flex flex-col gap-1.5">
            <p className="text-base font-semibold text-pretty">
              Claimed: {amountsText(outcome.moved)} is in your private balance.
            </p>
            {claim.order ? <OrderId id={claim.order} /> : null}
          </output>
        </Card>
        <PlaceLink place="wallet">Back to your wallet</PlaceLink>
        <button
          type="button"
          onClick={clearClaim}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}
        >
          Claim another link
        </button>
      </div>
    );
  }
  if (outcome.kind !== "failed") {
    return (
      <Card>
        <p className="text-sm font-medium">Nothing is in this link right now.</p>
        <span className="flex gap-2">
          <Again code={claim.code} label="Check again" />
          <Different />
        </span>
      </Card>
    );
  }
  const words = FAILURE_WORDS[outcome.facts.kind];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <MovedLine moved={outcome.moved} />
        <ProblemLine text={words.title} next={words.body} />
        {claim.order ? <OrderId id={claim.order} /> : null}
      </Card>
      {outcome.facts.maybeMoved ? (
        <>
          <PlaceLink place="orders">See the order</PlaceLink>
          <Again code={claim.code} label="Read the link again" />
        </>
      ) : (
        <button
          type="button"
          onClick={() => void claimIt()}
          className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
        >
          {outcome.moved.length > 0 ? "Claim the rest" : "Try again"}
        </button>
      )}
    </div>
  );
}

function Again({ code, label = "Try again" }: { readonly code: string; readonly label?: string }) {
  return (
    <button
      type="button"
      onClick={() => void openClaim(code)}
      className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
    >
      {label}
    </button>
  );
}

function Ready({ holdings }: { readonly holdings: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="text-base font-semibold text-pretty">This link holds {holdings}.</p>
        <p className="text-label text-pretty text-muted-foreground">
          Public: a one-time address paid your zSol address. Hidden: the amount and the token.
        </p>
        <p className="text-label text-pretty text-muted-foreground">
          Claiming is free: the sender paid zSol's fee.
        </p>
      </Card>
      <button
        type="button"
        onClick={() => void claimIt()}
        className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
      >
        Claim it
      </button>
      <Different />
    </div>
  );
}

function Different() {
  return (
    <button
      type="button"
      onClick={clearClaim}
      className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}
    >
      Use a different link
    </button>
  );
}

function LinkForm({ broken, site }: { readonly broken: boolean; readonly site: string }) {
  const [text, setText] = useState("");
  const tabLink = useTabLink(site);
  const ids = { field: useId(), note: useId() };
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void openClaim(text);
      }}
    >
      <Card>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.field} className="text-label font-medium text-muted-foreground">
            The link
          </label>
          <input
            id={ids.field}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={`${site}/claim#…`}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={broken}
            aria-describedby={broken ? ids.note : undefined}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2 font-mono text-label outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          />
          {broken ? (
            <span id={ids.note}>
              <ProblemLine
                text="This link is incomplete."
                next="Ask the sender for the whole link, with everything after the #."
              />
            </span>
          ) : null}
        </div>
        {tabLink ? (
          <button
            type="button"
            onClick={() => void openClaim(tabLink)}
            className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
          >
            Use the link open in this tab
          </button>
        ) : null}
      </Card>
      <button type="submit" className={buttonVariants({ size: "lg", className: "h-10 w-full" })}>
        Open the link
      </button>
    </form>
  );
}
