import { describe, expect, it } from "vitest";

import { placeFromHash, placeHref, tabOf } from "./places";

describe("places", () => {
  it("reads the place from the hash, the wallet when none", () => {
    expect(placeFromHash(placeHref("send"))).toBe("send");
    expect(placeFromHash("#send")).toBe("send");
    expect(placeFromHash("#/orders")).toBe("orders");
    expect(placeFromHash("#/unshield")).toBe("unshield");
    expect(tabOf("unshield")).toBe("wallet");
    expect(tabOf("send")).toBe("send");
    expect(placeFromHash("")).toBe("wallet");
    expect(placeFromHash("#/elsewhere")).toBe("wallet");
  });
});
