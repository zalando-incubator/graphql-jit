import { type ExecutionContext } from "./execution";

export const GLOBAL_RUNTIME_NAME = "__rt";

export interface JitRuntime {
  isPromise(value: unknown): boolean;
  handleResolverResult(
    ctx: ExecutionContext,
    value: unknown,
    onSuccess: (result: unknown) => void,
    onError: (err: unknown) => void
  ): void;
  handleListItemResult(
    ctx: ExecutionContext,
    item: unknown,
    onSuccess: (result: unknown) => void,
    onError: (err: unknown) => void
  ): void;
  safeMap(
    context: ExecutionContext,
    iterable: Iterable<unknown> | string,
    cb: (
      context: ExecutionContext,
      a: unknown,
      index: number,
      resultArray: unknown[],
      ...idx: number[]
    ) => void,
    ...idx: number[]
  ): unknown[];
}

export const jitRuntime: JitRuntime = {
  isPromise(value: unknown): boolean {
    return (
      value != null &&
      typeof value === "object" &&
      typeof (value as any).then === "function"
    );
  },

  handleResolverResult(ctx, value, onSuccess, onError) {
    if (this.isPromise(value)) {
      ++ctx.promiseCounter;
      (value as Promise<unknown>).then(
        (result) => {
          onSuccess(result);
          --ctx.promiseCounter;
          if (ctx.promiseCounter === 0) {
            ctx.resolve!(ctx);
          }
        },
        (err) => {
          onError(err);
          --ctx.promiseCounter;
          if (ctx.promiseCounter === 0) {
            ctx.resolve!(ctx);
          }
        }
      );
    } else {
      onSuccess(value);
    }
  },

  handleListItemResult(ctx, item, onSuccess, onError) {
    if (this.isPromise(item)) {
      ++ctx.promiseCounter;
      (item as Promise<unknown>).then(
        (result) => {
          onSuccess(result);
          --ctx.promiseCounter;
          if (ctx.promiseCounter === 0) {
            ctx.resolve!(ctx);
          }
        },
        (err) => {
          onError(err);
          --ctx.promiseCounter;
          if (ctx.promiseCounter === 0) {
            ctx.resolve!(ctx);
          }
        }
      );
    } else {
      onSuccess(item);
    }
  },

  safeMap(ctx, iterable, cb, ...idx) {
    let index = 0;
    const result: unknown[] = [];
    for (const a of iterable as Iterable<unknown>) {
      cb(ctx, a, index, result, ...idx);
      ++index;
    }
    return result;
  }
};
