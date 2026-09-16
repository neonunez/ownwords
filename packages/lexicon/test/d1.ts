import { DatabaseSync, type StatementSync } from 'node:sqlite';

type BindValue = string | number | null | ArrayBuffer | ArrayBufferView;

class TestStatement {
  constructor(
    private readonly database: TestD1Database,
    readonly sql: string,
    readonly values: BindValue[] = [],
  ) {}

  bind(...values: BindValue[]): D1PreparedStatement {
    return new TestStatement(this.database, this.sql, values) as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const row = this.statement().get(...this.sqliteValues()) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return (column === undefined ? row : row[column]) as T;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const results = this.statement().all(...this.sqliteValues()) as T[];
    return result(results, 0);
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.executeRun<T>();
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const statement = this.statement();
    const names = statement.columns().map((column) => column.name);
    return statement.all(...this.sqliteValues()).map((row) => names.map((name) => (row as Record<string, unknown>)[name]) as T);
  }

  executeRun<T = unknown>(): D1Result<T> {
    const outcome = this.statement().run(...this.sqliteValues());
    return result<T>([], Number(outcome.changes), Number(outcome.lastInsertRowid));
  }

  private statement(): StatementSync {
    return this.database.sqlite.prepare(this.sql);
  }

  private sqliteValues(): (string | number | null | Uint8Array)[] {
    return this.values.map((value) => {
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return value;
    });
  }
}

export class TestD1Database {
  readonly sqlite = new DatabaseSync(':memory:');

  prepare(sql: string): D1PreparedStatement {
    return new TestStatement(this, sql) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => (statement as unknown as TestStatement).executeRun<T>());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.sqlite.exec(query);
    return { count: 0, duration: 0 };
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }

  close(): void {
    this.sqlite.close();
  }
}

function result<T>(results: T[], changes: number, lastRowId = 0): D1Result<T> {
  return {
    success: true,
    results,
    meta: {
      changed_db: changes > 0,
      changes,
      duration: 0,
      last_row_id: lastRowId,
      rows_read: 0,
      rows_written: changes,
      served_by_primary: true,
      served_by_region: 'test',
      size_after: 0,
    },
  };
}
