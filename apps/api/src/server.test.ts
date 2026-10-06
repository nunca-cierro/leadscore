import { describe, expect, it } from "vitest";
import { createApp } from "./server.js";

describe("createApp", () => {
  it("GET /health → 200 con { ok: true }", async () => {
    const app = createApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await app.close();
  });
});
