import { describe, expect, it } from "vitest";

import {
  canStillLand,
  clockOf,
  currentStep,
  finishOrder,
  openOrder,
  orderIdOf,
  orphanOf,
  pruned,
  signedWith,
  stepAt,
  stopOrder,
  unsureOrder,
  KEEP_ENDED_MS,
  type Order,
} from "./order-model";

const open = (now = 1_000) =>
  openOrder({
    id: "K7Q2-M4XD",
    kind: "send-dark",
    now,
    facts: { amount: "0.5 SOL", to: "DG3t…Ejsg" },
    steps: ["sign", "send", "land", "read"],
    runner: "window-a",
  });

describe("an order", () => {
  it("is called by a short id that reads the same aloud", () => {
    expect(orderIdOf(new Uint8Array([0, 0, 0, 0, 0]))).toBe("0000-0000");
    expect(orderIdOf(new Uint8Array([255, 255, 255, 255, 255]))).toBe("ZZZZ-ZZZZ");
    expect(orderIdOf(new Uint8Array([1, 2, 3, 4, 5]))).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
    );
    expect(() => orderIdOf(new Uint8Array(4))).toThrow();
  });

  it("moves step by step, each done as the next starts", () => {
    let order = stepAt(open(), "sign", 1_100);
    order = stepAt(order, "land", 1_500);
    expect(order.steps.map((step) => step.state)).toEqual(["done", "done", "active", "waiting"]);
    expect(currentStep(order)?.key).toBe("land");
    order = finishOrder(order, 2_000);
    expect(order.state).toBe("done");
    expect(order.runner).toBeUndefined();
    expect(order.steps.every((step) => step.state === "done")).toBe(true);
    expect(stepAt(order, "sign", 3_000)).toBe(order);
  });

  it("marks where it stopped, and says why", () => {
    const order = stopOrder(stepAt(open(), "send", 1_200), 1_300, {
      title: "It didn't go through.",
    });
    expect(order.state).toBe("stopped");
    expect(order.steps.map((step) => step.state)).toEqual(["done", "failed", "waiting", "waiting"]);
    expect(order.stop?.title).toBe("It didn't go through.");
  });

  it("knows what a closed panel left behind", () => {
    const unsigned = stepAt(open(), "sign", 1_100);
    expect(orphanOf(unsigned)).toBe("never-sent");
    const signed = signedWith(unsigned, "5Sig", 1_200);
    expect(orphanOf(signed)).toBe("ask-chain");
    expect(canStillLand(signed, 1_200 + 60_000)).toBe(true);
    expect(canStillLand(signed, 1_200 + 4 * 60_000)).toBe(false);
    expect(unsureOrder(signed)).toMatchObject({ state: "unsure", signed: "5Sig" });
  });

  it("reads its clock plainly", () => {
    expect(clockOf(42_500)).toBe("0:42");
    expect(clockOf(3_909_000)).toBe("1:05:09");
    expect(clockOf(-5)).toBe("0:00");
  });

  it("keeps the newest, and ended ones for a week", () => {
    const now = 10 * KEEP_ENDED_MS;
    const old: Order = finishOrder(open(1), 2);
    const recent: Order = { ...finishOrder(open(now - 1_000), now - 500), id: "B" };
    const running: Order = { ...open(5), id: "C" };
    expect(pruned([old, running, recent], now).map((order) => order.id)).toEqual(["B", "C"]);
  });
});
