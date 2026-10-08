import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAsync } from "./useAsync";
import type { OwnwordsClient } from "../../api/client";

/** Only the scope matters to remembering; nothing else on the client is used. */
function scopedClient(scope: { current: string | null }) {
  return { readScope: () => scope.current } as unknown as OwnwordsClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

describe("useAsync remembering", () => {
  it("opens again on the last answer while it reads again", async () => {
    const scope = { current: "account-a" };
    const client = scopedClient(scope);
    const first = renderHook(() =>
      useAsync(async () => "first", [client], { client, key: "k" }),
    );
    await waitFor(() => expect(first.result.current.data).toBe("first"));
    first.unmount();

    const fresh = deferred<string>();
    const second = renderHook(() =>
      useAsync(() => fresh.promise, [client], { client, key: "k" }),
    );
    expect(second.result.current.data).toBe("first");
    expect(second.result.current.loading).toBe(true);
    await act(async () => fresh.resolve("second"));
    expect(second.result.current.data).toBe("second");
    expect(second.result.current.loading).toBe(false);
  });

  it("never shows one account's answer to another, or when signed out", async () => {
    const scope: { current: string | null } = { current: "account-a" };
    const client = scopedClient(scope);
    const first = renderHook(() =>
      useAsync(async () => "a's answer", [client], { client, key: "k" }),
    );
    await waitFor(() => expect(first.result.current.data).toBe("a's answer"));
    first.unmount();

    scope.current = "account-b";
    const other = renderHook(() =>
      useAsync(() => new Promise<string>(() => {}), [client], {
        client,
        key: "k",
      }),
    );
    expect(other.result.current.data).toBeNull();
    other.unmount();

    // Coming back to the first account finds nothing either: it was dropped.
    scope.current = "account-a";
    const back = renderHook(() =>
      useAsync(() => new Promise<string>(() => {}), [client], {
        client,
        key: "k",
      }),
    );
    expect(back.result.current.data).toBeNull();
    back.unmount();

    scope.current = null;
    const signedOut = renderHook(() =>
      useAsync(() => new Promise<string>(() => {}), [client], {
        client,
        key: "k",
      }),
    );
    expect(signedOut.result.current.data).toBeNull();
  });

  it("does not keep an answer whose scope changed while it was read", async () => {
    const scope = { current: "account-a" };
    const client = scopedClient(scope);
    const late = deferred<string>();
    const first = renderHook(() =>
      useAsync(() => late.promise, [client], { client, key: "k" }),
    );
    scope.current = "account-b";
    await act(async () => late.resolve("read under a"));
    first.unmount();

    const next = renderHook(() =>
      useAsync(() => new Promise<string>(() => {}), [client], {
        client,
        key: "k",
      }),
    );
    expect(next.result.current.data).toBeNull();
  });

  it("keeps a mutation's value, and nothing for reads that do not opt in", async () => {
    const scope = { current: "account-a" };
    const client = scopedClient(scope);
    const first = renderHook(() =>
      useAsync(async () => "read", [client], { client, key: "k" }),
    );
    await waitFor(() => expect(first.result.current.data).toBe("read"));
    act(() => first.result.current.set("saved"));
    first.unmount();

    const again = renderHook(() =>
      useAsync(() => new Promise<string>(() => {}), [client], {
        client,
        key: "k",
      }),
    );
    expect(again.result.current.data).toBe("saved");

    const plain = renderHook(() =>
      useAsync(() => new Promise<string>(() => {}), [client]),
    );
    expect(plain.result.current.data).toBeNull();
  });
});
