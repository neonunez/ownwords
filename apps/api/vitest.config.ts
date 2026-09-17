import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(projectDirectory, "wrangler.jsonc") },
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
          ENVIRONMENT: "test",
          INVITATION_ADMIN_TOKEN: "ab".repeat(32),
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(projectDirectory, "..", "..", ".wrangler", "migrations"),
          ),
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
