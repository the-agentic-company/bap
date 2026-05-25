import { describe, expect, it } from "vitest";
import type { LocalContext } from "../../context";
import hi from "./impl";

describe("hi command", () => {
  it("prints hi", async () => {
    let output = "";
    const context = {
      process: {
        stdout: {
          write(chunk: string) {
            output += chunk;
            return true;
          },
        },
      },
    } as LocalContext;

    await hi.call(context);

    expect(output).toBe("hi\n");
  });
});
