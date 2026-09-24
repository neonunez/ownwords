export async function first<T>(
  statement: D1PreparedStatement,
): Promise<T | null> {
  return await statement.first<T>();
}

export async function all<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results;
}

export async function run(statement: D1PreparedStatement): Promise<D1Result> {
  return await statement.run();
}

export function encodeJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function decodeJson<T>(value: string | null): T | null {
  if (value === null) return null;
  return JSON.parse(value) as T;
}

export function changed(result: D1Result): number {
  return result.meta.changes ?? 0;
}
