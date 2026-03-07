export type Ok<T> = { type: "ok"; value: T };
export type Err<E> = { type: "err"; value: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<const T>(value: T): Ok<T> {
  return { type: "ok", value };
}

export function err<const E>(value: E): Err<E> {
  return { type: "err", value };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.type === "ok";
}

// Collection utilities
export function all<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!isOk(r)) {
      return r;
    }
    values.push(r.value);
  }
  return ok(values);
}

export async function allAsync<T, E>(promises: Promise<Result<T, E>>[]): Promise<Result<T[], E>> {
  const results = await Promise.all(promises);
  return all(results);
}

export async function tryCatch<T, E>(
  fn: () => Promise<T>,
  onError: (error: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (error) {
    return err(onError(error));
  }
}

type Flow<T, E> = {
  map<U>(fn: (value: T) => U): Flow<U, E>;
  andThen<U, F>(fn: (value: T) => Result<U, F>): Flow<U, E | F>;
  asyncAndThen<U, F>(fn: (value: T) => Promise<Result<U, F>>): Flow<U, E | F>;
  value(): Promise<Result<T, E>>;
};

export function flow<T>(initial: T): Flow<T, never> {
  const current: Promise<Result<T, never>> = Promise.resolve(ok(initial));

  function makeFlow<U, F>(p: Promise<Result<U, F>>): Flow<U, F> {
    return {
      map<V>(fn: (value: U) => V): Flow<V, F> {
        const next = p.then((r) => (isOk(r) ? ok(fn(r.value)) : r));
        return makeFlow(next);
      },
      andThen<V, G>(fn: (value: U) => Result<V, G>): Flow<V, F | G> {
        const next = p.then((r): Result<V, F | G> => (isOk(r) ? fn(r.value) : r));
        return makeFlow(next);
      },
      asyncAndThen<V, G>(fn: (value: U) => Promise<Result<V, G>>): Flow<V, F | G> {
        const next = p.then(
          (r): Promise<Result<V, F | G>> => (isOk(r) ? fn(r.value) : Promise.resolve(r)),
        );
        return makeFlow(next);
      },
      value(): Promise<Result<U, F>> {
        return p;
      },
    };
  }

  return makeFlow(current);
}
