import { describe, expect, it } from "vitest";
import * as shared from "./index";

describe("shared", () => {
  it("se importa sin romper", () => {
    expect(shared).toBeDefined();
  });
});
