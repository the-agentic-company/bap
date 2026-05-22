import { describe, expect, it } from "vitest";
import { chatCommand } from "./command";

describe("chat command flags", () => {
  it("exposes the timing and perfettoTrace flags and removes chromeTrace", () => {
    const flags = (chatCommand as { parameters?: { flags?: Record<string, unknown> } }).parameters
      ?.flags;
    expect(flags?.timing).toBeDefined();
    expect(flags?.perfettoTrace).toBeDefined();
    expect(flags?.chaosRunDeadline).toBeDefined();
    expect(flags?.chaosApproval).toBeDefined();
    expect(flags?.chaosApprovalParkAfter).toBeDefined();
    expect(flags?.open).toBeDefined();
    expect(flags?.attach).toBeDefined();
    expect(flags?.attachGeneration).toBeDefined();
    expect(flags?.chromeTrace).toBeUndefined();
  });

  it("accepts one optional positional message", () => {
    const positional = (chatCommand as {
      parameters?: { positional?: { kind?: string; parameters?: Array<{ placeholder?: string }> } };
    }).parameters?.positional;

    expect(positional?.kind).toBe("tuple");
    expect(positional?.parameters?.[0]?.placeholder).toBe("message");
  });
});
