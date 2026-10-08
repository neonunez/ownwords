import { useEffect, useState } from "react";
import type { OwnwordsClient } from "../../api/client";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
  /** Replaces the held value after a mutation, without a round trip. */
  set: (next: T) => void;
}

interface Held<T> {
  data: T | null;
  error: Error | null;
  /** The run this value came from; an older run's answer is dropped. */
  run: number;
}

/**
 * Lets a screen open on what it last showed, while it reads again.
 *
 * `key` names the answer, including anything the read depends on, such as a
 * search. Only reads whose answer is safe to show for a moment while a fresh
 * one arrives should opt in: never a practice sitting, a lesson being worked
 * through, or anything edited by version.
 */
export interface Remember {
  client: OwnwordsClient;
  key: string;
}

/** The most answers a client keeps for screens; the oldest go first. */
const REMEMBERED = 32;

/**
 * Per client, and only for the one account and profile the client verified:
 * a different scope (another account, a changed profile, signed out) finds
 * nothing and drops everything kept. Nothing here is persisted.
 */
const memories = new WeakMap<
  OwnwordsClient,
  { scope: string; values: Map<string, unknown> }
>();

function recall(remember: Remember): unknown {
  const scope = remember.client.readScope?.() ?? null;
  const memory = memories.get(remember.client);
  if (scope === null || memory?.scope !== scope) {
    memories.delete(remember.client);
    return null;
  }
  return memory.values.get(remember.key) ?? null;
}

function keep(remember: Remember, scope: string | null, value: unknown) {
  if (scope === null || remember.client.readScope?.() !== scope) return;
  let memory = memories.get(remember.client);
  if (memory?.scope !== scope) {
    memory = { scope, values: new Map() };
    memories.set(remember.client, memory);
  }
  memory.values.delete(remember.key);
  memory.values.set(remember.key, value);
  while (memory.values.size > REMEMBERED)
    memory.values.delete(memory.values.keys().next().value!);
}

/**
 * Reads one thing through the client and keeps its loading and failure states.
 *
 * `keys` says when to read again, the way a dependency array does. The reader
 * is called on every change and its answer is kept only if it is still the
 * latest one, so a fast second read never loses to a slow first.
 *
 * With `remember`, a screen opened again shows its last answer at once and
 * replaces it when the new read arrives; `loading` stays true until then.
 */
export function useAsync<T>(
  read: () => Promise<T>,
  keys: readonly unknown[],
  remember?: Remember,
): AsyncState<T> {
  const [held, setHeld] = useState<Held<T>>(() => ({
    data: remember ? (recall(remember) as T | null) : null,
    error: null,
    run: -1,
  }));
  const [run, setRun] = useState(0);

  useEffect(() => {
    let live = true;
    const scope = remember?.client.readScope?.() ?? null;
    read()
      .then((value) => {
        if (!live) return;
        if (remember) keep(remember, scope, value);
        setHeld({ data: value, error: null, run });
      })
      .catch((cause: unknown) => {
        if (live) {
          setHeld({
            data: null,
            error: cause instanceof Error ? cause : new Error(String(cause)),
            run,
          });
        }
      });
    return () => {
      live = false;
    };
    // `keys` is the caller's dependency list; `run` re-reads on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...keys]);

  return {
    data: held.data,
    error: held.error,
    // A read is in flight until an answer for this run arrives.
    loading: held.run !== run,
    reload: () => setRun((value) => value + 1),
    set: (next: T) => {
      if (remember) keep(remember, remember.client.readScope?.() ?? null, next);
      setHeld({ data: next, error: null, run });
    },
  };
}
