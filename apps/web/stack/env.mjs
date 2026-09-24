// Shared by the stack server and the stack tests.
import { tmpdir } from "node:os";
import path from "node:path";

export const WEB_PORT = Number(process.env.STACK_WEB_PORT ?? 4180);
export const API_PORT = Number(process.env.STACK_API_PORT ?? 8790);
/** The app's origin. `localhost`, so the passkey relying party ID is `localhost`. */
export const ORIGIN = `http://localhost:${WEB_PORT}`;
/** Where the local D1 state and the seeded sessions live for one run. */
export const STATE = path.join(tmpdir(), `ownwords-stack-${WEB_PORT}`);
/** A test-only invitation administration token; the format the API requires. */
export const ADMIN_TOKEN = "cd".repeat(32);

/** One synthetic account per journey, so no test sees another's data. */
export const USERS = {
  newcomer: "newcomer@example.com",
  collector: "collector@example.com",
  learner: "learner@example.com",
  owner: "owner@example.com",
  stranger: "stranger@example.com",
  leaver: "leaver@example.com",
  keyholder: "keyholder@example.com",
  offline: "offline@example.com",
  exporter: "exporter@example.com",
  firstrun: "firstrun@example.com",
};
