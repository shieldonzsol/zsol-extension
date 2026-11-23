import { describe, expect, it } from "vitest";

import { buildStopOf } from "./build-errors";

describe("the SDK's build errors", () => {
  it("reads the innermost known reason", () => {
    expect(
      buildStopOf({
        code: "WALLET_BUILD_TRANSFER",
        causeCodes: ["WALLET_CREATE", "WALLET_MULTIPLE_INPUT_TREES"],
      }),
    ).toBe("split");
    expect(
      buildStopOf({ code: "WALLET_BUILD_TRANSFER", causeCode: "WALLET_RECIPIENT_NOT_REGISTERED" }),
    ).toBe("recipient");
  });

  it("falls back on the kind of code, and leaves other errors alone", () => {
    expect(buildStopOf({ code: "WALLET_BUILD_TRANSFER", causeCodes: ["CLIENT_RPC_FAILED"] })).toBe(
      "indexer",
    );
    expect(buildStopOf({ code: "WALLET_SOMETHING_NEW" })).toBe("build");
    expect(buildStopOf(new TypeError("Failed to fetch"))).toBeNull();
    expect(buildStopOf(null)).toBeNull();
  });
});
