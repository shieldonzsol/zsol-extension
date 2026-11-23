// What stopped the Rings SDK from building a private transaction, in terms a person can act on.
// The SDK wraps the reason in layers, so the innermost known code decides.

export type BuildStop =
  /** The balance covers it, but part is held for a moment or not settled yet. */
  | "held"
  /** It sits in two of Rings' trees, and one transaction spends from one. */
  | "split"
  /** It is in more pieces than one transaction takes. */
  | "pieces"
  /** Rings' indexer or the network didn't answer while it was built. */
  | "indexer"
  /** A receiver has no private wallet on this network. */
  | "recipient"
  | "build";

const BY_CAUSE: Readonly<Record<string, BuildStop>> = {
  WALLET_INSUFFICIENT_BALANCE: "held",
  WALLET_NOTE_RESERVED: "held",
  WALLET_INPUT_UTXO_UNAVAILABLE: "held",
  WALLET_MULTIPLE_INPUT_TREES: "split",
  WALLET_INPUT_UTXO_TREE_MISMATCH: "split",
  WALLET_TOO_MANY_INPUTS: "pieces",
  WALLET_SYNC: "indexer",
  WALLET_FETCH_USER_RECORD: "indexer",
  WALLET_PROTOCOL_CONFIG_NOT_FOUND: "indexer",
  WALLET_RECIPIENT_NOT_REGISTERED: "recipient",
  WALLET_RECIPIENT_CLIENT_REQUIRED: "recipient",
};

function fieldsOf(error: object): Record<string, unknown> {
  return Object.fromEntries(
    ["code", "causeCode", "causeCodes"].map((name) => [name, Reflect.get(error, name)]),
  );
}

/** The SDK's build error read as a stop, or null when the error isn't the SDK's. */
export function buildStopOf(error: unknown): BuildStop | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, causeCode, causeCodes } = fieldsOf(error);
  if (typeof code !== "string" || !code.startsWith("WALLET_")) return null;
  const chain = [
    code,
    ...(Array.isArray(causeCodes)
      ? causeCodes.filter((each): each is string => typeof each === "string")
      : typeof causeCode === "string"
        ? [causeCode]
        : []),
  ];
  const known = chain.toReversed().find((each) => BY_CAUSE[each] !== undefined);
  if (known !== undefined) return BY_CAUSE[known] ?? "build";
  return chain.some((each) => /CLIENT|TRANSPORT|RPC|PROOF/.test(each)) ? "indexer" : "build";
}
