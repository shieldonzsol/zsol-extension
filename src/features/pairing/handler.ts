import type { CodeCheck } from "./code";
import {
  HELLO,
  PAIRING_VERSION,
  newPairingKey,
  openPairing,
  parseMessage,
  type HelloReply,
  type PairingKey,
  type PairingPayload,
  type SealReply,
} from "./protocol";

export interface MessageSender {
  readonly id?: string;
  readonly origin?: string;
}

export interface Tickets {
  check(typed: string): CodeCheck;
  current(): string;
  spend(): void;
}

export interface PairingHandlerDeps {
  readonly extensionId: string;
  readonly origins: readonly string[];
  readonly tickets: Tickets;
  /** `site` is the zSol that handed the account over: the panel calls its API. */
  readonly onPaired: (payload: PairingPayload, site: string) => void;
}

const refusal = { ok: false } as const;

export function createPairingHandler(deps: PairingHandlerDeps) {
  let key: { readonly code: string; readonly key: PairingKey } | null = null;

  return async function handle(
    value: unknown,
    sender: MessageSender,
  ): Promise<HelloReply | SealReply> {
    // Other extensions carry an id; pages must be zsol.cc.
    if (sender.id !== undefined && sender.id !== deps.extensionId) {
      return { ...refusal, reason: "not-allowed" };
    }
    const origin = sender.origin;
    if (origin === undefined || !deps.origins.includes(origin)) {
      return { ...refusal, reason: "not-allowed" };
    }
    const message = parseMessage(value);
    if (message === null) return { ...refusal, reason: "malformed" };

    const checked = deps.tickets.check(message.code);
    if (checked !== "ok") return { ...refusal, reason: reasonFor(checked) };
    const code = deps.tickets.current();

    if (message.type === HELLO) {
      if (key?.code !== code) key = { code, key: await newPairingKey() };
      return { ok: true, v: PAIRING_VERSION, key: key.key.publicKey };
    }

    if (key?.code !== code) return { ...refusal, reason: "malformed" };
    const payload = await openPairing(key.key, message.box, {
      code,
      origin,
      extensionId: deps.extensionId,
    });
    if (payload === null) {
      // Counts as a wrong try, so boxes can't probe the code.
      deps.tickets.check("");
      return { ...refusal, reason: "malformed" };
    }
    key = null;
    deps.tickets.spend();
    deps.onPaired(payload, origin);
    return { ok: true };
  };
}

function reasonFor(check: Exclude<CodeCheck, "ok">) {
  return check === "wrong" ? "wrong-code" : check;
}
