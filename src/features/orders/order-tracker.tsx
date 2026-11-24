import { CheckIcon, CopyIcon, ExternalLinkIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { useNow } from "@/features/wallet/use-now";
import { cn } from "@/lib/utils";

import { clockOf, type Order, type OrderStep } from "./order-model";
import { KIND_WORDS, STATE_WORDS, STEP_WORDS, UNSURE_WORDS } from "./order-words";

/** An order's title: what it does, with what, to whom. */
export function orderTitle(order: Order): string {
  const { amount, to, count, gets } = order.facts;
  const what = KIND_WORDS[order.kind];
  if (gets && amount) return `${what}: ${amount} for ${gets}`;
  if (count)
    return amount
      ? `${what}: ${amount} to ${String(count)} people`
      : `${what} to ${String(count)} people`;
  if (amount && to) return `${what}: ${amount} to ${to}`;
  return amount ? `${what}: ${amount}` : what;
}

export function OrderId({ id }: { readonly id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const label = copied ? "Copied" : `Copy order ${id}`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => void navigator.clipboard.writeText(id).then(() => setCopied(true))}
      className="inline-flex items-center gap-1 rounded-sm font-mono text-label text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      translate="no"
    >
      {id}
      {copied ? (
        <CheckIcon className="size-3" strokeWidth={2} />
      ) : (
        <CopyIcon className="size-3" strokeWidth={1.75} />
      )}
    </button>
  );
}

function StepLine({
  step,
  now,
  running,
}: {
  readonly step: OrderStep;
  readonly now: number;
  /** A panel is at work on it: an open step's clock runs. */
  readonly running: boolean;
}) {
  const words = STEP_WORDS[step.key] ?? { active: step.key, done: step.key };
  const took =
    step.startedAt === undefined || (step.endedAt === undefined && !running)
      ? null
      : clockOf((step.endedAt ?? now) - step.startedAt);
  return (
    <li
      aria-current={step.state === "active" ? "step" : undefined}
      className={cn(
        "flex items-center gap-2.5 text-sm",
        step.state === "waiting" ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {step.state === "done" ? (
        <CheckIcon className="size-4 shrink-0 text-ok" strokeWidth={2} />
      ) : step.state === "active" ? (
        <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-primary" strokeWidth={2} />
      ) : step.state === "failed" ? (
        <XIcon className="size-4 shrink-0 text-destructive" strokeWidth={2} />
      ) : (
        <span
          aria-hidden="true"
          className="mx-1.5 size-1 shrink-0 rounded-full bg-muted-foreground"
        />
      )}
      <span className="min-w-0 flex-1">{step.state === "done" ? words.done : words.active}</span>
      {took !== null && step.state !== "waiting" ? (
        <span className="shrink-0 text-label text-muted-foreground tabular-nums">{took}</span>
      ) : null}
    </li>
  );
}

/** An order as it goes: its title, its id, each step with its clock, and how it ended. */
export function OrderTracker({ order, site }: { readonly order: Order; readonly site: string }) {
  const live = order.state === "running" || order.state === "unsure";
  const now = useNow(live ? 1_000 : 60_000);
  const total = clockOf((order.endedAt ?? now) - order.createdAt);
  return (
    <section
      aria-label={`Order ${order.id}`}
      className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium text-pretty">{orderTitle(order)}</p>
          <OrderId id={order.id} />
        </div>
        <span className="shrink-0 text-label text-muted-foreground tabular-nums">
          {STATE_WORDS[order.state]} · {total}
        </span>
      </div>
      <ol aria-label="Steps" className="flex flex-col gap-2.5">
        {order.steps.map((step) => (
          <StepLine key={step.key} step={step} now={now} running={order.state === "running"} />
        ))}
      </ol>
      {order.state === "unsure" ? (
        <output className="flex flex-col gap-1 text-label text-pretty">
          <span className="font-medium">{UNSURE_WORDS.title}</span>
          <span className="text-muted-foreground">{UNSURE_WORDS.body}</span>
        </output>
      ) : null}
      {order.state === "stopped" && order.stop ? (
        <div role="alert" className="flex flex-col gap-1 text-label text-pretty">
          <span className="font-medium">{order.stop.title}</span>
          {order.stop.body ? (
            <span className="text-muted-foreground">{order.stop.body}</span>
          ) : null}
        </div>
      ) : null}
      {order.signature ? (
        <a
          href={`${site}/tx/${order.signature}`}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
        >
          See what the public sees
          <ExternalLinkIcon data-icon="inline-end" strokeWidth={1.75} />
        </a>
      ) : null}
    </section>
  );
}
