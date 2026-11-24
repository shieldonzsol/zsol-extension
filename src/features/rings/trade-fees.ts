// zSol's fees on a trade, in SOL: 1% from the private balance, 1.5% from a ghost wallet. zSol's
// server checks the same; a panel never pays more than these.
const BPS = 10_000n;

const ceilBps = (amount: bigint, bps: bigint) => (amount * bps + BPS - 1n) / BPS;

export const TRADE_FEE_BPS = 100n;
export const GHOST_TRADE_FEE_BPS = 150n;
/** How far zSol's own quote may move the fee from the panel's, either way. */
export const TRADE_FEE_TOLERANCE_BPS = 300n;

/** 1% of a SOL value, never under `minimum` on a trade worth anything. */
export function tradeFee(solValue: bigint, minimum = 0n): bigint {
  if (solValue <= 0n) return 0n;
  const fee = ceilBps(solValue, TRADE_FEE_BPS);
  return fee < minimum ? minimum : fee;
}

export function ghostTradeFee(solValue: bigint): bigint {
  return ceilBps(solValue, GHOST_TRADE_FEE_BPS);
}

/** The most zSol's server may charge for a swap the panel priced at `expected`. */
export function mostGhostFee(expected: bigint): bigint {
  return expected + ceilBps(expected, TRADE_FEE_TOLERANCE_BPS);
}
