import { describe, expect, it } from "vitest";

import { hasCustomerDivergence } from "@/app/lib/helpers";

describe("hasCustomerDivergence", () => {
  it("does not flag a matching customer name", () => {
    expect(
      hasCustomerDivergence(
        { customer: "Acme Corp" },
        "Save a note for Acme Corp about pricing"
      )
    ).toBeNull();
  });

  it("accepts the first customer word used in natural speech", () => {
    expect(
      hasCustomerDivergence(
        { customer: "Atmos Industrial" },
        "Remind me to call Atmos on Friday"
      )
    ).toBeNull();
  });

  it("returns the tool customer when transcript and tool disagree", () => {
    expect(
      hasCustomerDivergence(
        { customer: "Acme Corp" },
        "Save that note for Atmos"
      )
    ).toBe("Acme Corp");
  });

  it("ignores missing source text and malformed tool arguments", () => {
    expect(hasCustomerDivergence({ customer: "Acme Corp" }, undefined)).toBeNull();
    expect(hasCustomerDivergence(null, "Acme")).toBeNull();
    expect(hasCustomerDivergence({ customer: "" }, "Acme")).toBeNull();
  });
});
