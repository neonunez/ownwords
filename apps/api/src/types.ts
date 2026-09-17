export interface Bindings {
  DB: D1Database;
  ENVIRONMENT?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  TRUSTED_ORIGINS?: string;
  PASSKEY_RP_ID?: string;
  PASSKEY_RP_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  INVITATION_ADMIN_TOKEN?: string;
}

export interface VerifiedSession {
  userId: string;
  expiresAt: Date;
}

export interface Variables {
  userId: string;
  session: VerifiedSession;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

/** Shared contract for independently developed domain route packages. */
export type DomainEnv = {
  Bindings: { DB: D1Database };
  Variables: { userId: string };
};
