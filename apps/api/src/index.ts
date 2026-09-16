import { createApp } from "./app.js";

const app = createApp();

export { createApp } from "./app.js";
export type { AppDependencies } from "./app.js";
export type {
  AppEnv,
  Bindings,
  DomainEnv,
  SessionVerifier,
  Variables,
  VerifiedSession,
} from "./types.js";

export default app;
