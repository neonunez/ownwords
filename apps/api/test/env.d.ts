import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Bindings } from "../src/types.js";

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
    interface GlobalProps {
      mainModule: typeof import("../src/index.js");
    }
  }
}

export {};
