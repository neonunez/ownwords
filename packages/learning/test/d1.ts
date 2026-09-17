import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Bound = null | string | number | ArrayBuffer | ArrayBufferView;
type SqliteBound = null | string | number | bigint | Uint8Array;

function meta(changes = 0): D1Meta {
  return {
    changed_db: true,
    changes,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: changes,
    size_after: 0,
  } as D1Meta;
}

class TestStatement {
  constructor(
    readonly database: DatabaseSync,
    readonly sql: string,
    readonly bindings: readonly Bound[] = [],
  ) {}

  bind(...values: Bound[]): D1PreparedStatement {
    return new TestStatement(this.database, this.sql, values) as unknown as D1PreparedStatement;
  }

  private prepared(): StatementSync {
    return this.database.prepare(this.sql);
  }

  private sqliteBindings(): SqliteBound[] {
    return this.bindings.map((value) => {
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      }
      return value;
    });
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.prepared().get(...this.sqliteBindings()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.prepared().all(...this.sqliteBindings()) as T[];
    return { success: true, results, meta: meta() } as unknown as D1Result<T>;
  }

  runSync<T = Record<string, unknown>>(): D1Result<T> {
    const result = this.prepared().run(...this.sqliteBindings());
    return { success: true, results: [], meta: meta(Number(result.changes)) } as unknown as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.runSync<T>();
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const statement = this.prepared();
    statement.setReturnArrays(true);
    return statement.all(...this.sqliteBindings()) as T[];
  }
}

export class TestD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  readonly db: D1Database;

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    const migrationPath = fileURLToPath(new URL("../migrations/0200_learning.sql", import.meta.url));
    this.sqlite.exec(readFileSync(migrationPath, "utf8"));
    this.db = {
      prepare: (sql: string) => new TestStatement(this.sqlite, sql) as unknown as D1PreparedStatement,
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
        this.sqlite.exec("BEGIN IMMEDIATE");
        try {
          const results = statements.map((statement) => (statement as unknown as TestStatement).runSync<T>());
          this.sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          this.sqlite.exec("ROLLBACK");
          throw error;
        }
      },
      exec: async (sql: string) => {
        this.sqlite.exec(sql);
        return { count: 0, duration: 0 };
      },
      dump: async () => new ArrayBuffer(0),
      withSession: () => { throw new Error("not needed by learning tests"); },
    } as unknown as D1Database;
  }

  close(): void {
    this.sqlite.close();
  }
}

export function fixture(): unknown {
  const path = fileURLToPath(new URL("./fixtures/synthetic-russian.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}
