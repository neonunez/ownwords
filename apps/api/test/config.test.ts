import { describe, expect, it } from "vitest";
import { ConfigurationError, loadRuntimeConfig } from "../src/config.js";
import type { Bindings } from "../src/types.js";

function productionEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "production",
    BETTER_AUTH_SECRET: "production-test-secret-with-at-least-32-characters",
    BETTER_AUTH_URL: "https://app.example.com",
    TRUSTED_ORIGINS: "https://app.example.com",
    PASSKEY_RP_ID: "app.example.com",
    PASSKEY_RP_ORIGIN: "https://app.example.com",
    GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    ...overrides,
  };
}

describe("runtime configuration", () => {
  it("accepts an explicit secure production origin and passkey RP", () => {
    expect(loadRuntimeConfig(productionEnv())).toMatchObject({
      environment: "production",
      authUrl: "https://app.example.com",
      passkeyRpId: "app.example.com",
      passkeyOrigin: "https://app.example.com",
    });
  });

  it("does not allow local placeholders or missing Google credentials in production", () => {
    for (const overrides of [
      { BETTER_AUTH_SECRET: "replace-with-at-least-32-random-characters" },
      {
        BETTER_AUTH_URL: "http://localhost:8787",
        TRUSTED_ORIGINS: "http://localhost:8787",
      },
      { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined },
    ]) {
      expect(() => loadRuntimeConfig(productionEnv(overrides))).toThrow(
        ConfigurationError,
      );
    }
  });

  it("rejects wildcard origins and unrelated passkey RP IDs", () => {
    expect(() =>
      loadRuntimeConfig(productionEnv({ TRUSTED_ORIGINS: "*" })),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadRuntimeConfig(productionEnv({ PASSKEY_RP_ID: "attacker.example" })),
    ).toThrow(ConfigurationError);
  });
});
