export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json({ error: { code, message } } satisfies ApiErrorBody, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
