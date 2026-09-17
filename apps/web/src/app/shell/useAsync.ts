import { useEffect, useState } from 'react';

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
 * Reads one thing through the client and keeps its loading and failure states.
 *
 * `keys` says when to read again, the way a dependency array does. The reader
 * is called on every change and its answer is kept only if it is still the
 * latest one, so a fast second read never loses to a slow first.
 */
export function useAsync<T>(read: () => Promise<T>, keys: readonly unknown[]): AsyncState<T> {
  const [held, setHeld] = useState<Held<T>>({ data: null, error: null, run: -1 });
  const [run, setRun] = useState(0);

  useEffect(() => {
    let live = true;
    read()
      .then((value) => {
        if (live) setHeld({ data: value, error: null, run });
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
    set: (next: T) => setHeld({ data: next, error: null, run }),
  };
}
