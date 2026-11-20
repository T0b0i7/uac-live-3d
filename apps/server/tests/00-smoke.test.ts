import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

describe("démarrage de l'application", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it("s'assemble et répond sur /health", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.database).toBe("up");
    expect(body.postgis).toBeTruthy();
  });

  it("renvoie 404 structuré sur une route inconnue", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/inexistant" });
    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBeTruthy();
  });
});
