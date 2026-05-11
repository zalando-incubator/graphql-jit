import { type ExecutionContext } from "./execution";

export const GLOBAL_RUNTIME_NAME = "__rt";

export interface JitRuntime {
  isPromise(value: unknown): boolean;
  checkNonNullLeaf(
    ctx: ExecutionContext,
    value: unknown,
    dest: any[],
    nullMsg: string,
    locs: any,
    path: any,
    capStack: boolean,
    serialize: (
      c: ExecutionContext,
      v: any,
      onError: any,
      ...idx: number[]
    ) => any,
    errHandler: any,
    ...parentIndexes: number[]
  ): any;
  checkNullableLeaf(
    ctx: ExecutionContext,
    value: unknown,
    dest: any[],
    locs: any,
    path: any,
    capStack: boolean,
    serialize: (
      c: ExecutionContext,
      v: any,
      onError: any,
      ...idx: number[]
    ) => any,
    errHandler: any,
    ...parentIndexes: number[]
  ): any;
  callResolver(
    ctx: ExecutionContext,
    call: () => unknown,
    onSuccess: (result: unknown) => void,
    onError: (err: unknown) => void
  ): void;
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
  finalizeResult(ctx: ExecutionContext): Promise<unknown> | undefined;
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

  checkNonNullLeaf(
    ctx,
    value,
    dest,
    nullMsg,
    locs,
    path,
    capStack,
    serialize,
    errHandler,
    ...parentIndexes
  ) {
    const GQLError = ctx.GraphQLError as any;
    if (value == null) {
      dest.push(new GQLError(nullMsg, locs, path, undefined, capStack));
      return null;
    }
    if (value instanceof Error) {
      dest.push(
        new GQLError(
          value.message != null ? value.message : value,
          locs,
          path,
          value,
          capStack
        )
      );
      return null;
    }
    return serialize(ctx, value, errHandler, ...parentIndexes);
  },

  checkNullableLeaf(
    ctx,
    value,
    dest,
    locs,
    path,
    capStack,
    serialize,
    errHandler,
    ...parentIndexes
  ) {
    const GQLError = ctx.GraphQLError as any;
    if (value == null) return null;
    if (value instanceof Error) {
      dest.push(
        new GQLError(
          value.message != null ? value.message : value,
          locs,
          path,
          value,
          capStack
        )
      );
      return null;
    }
    return serialize(ctx, value, errHandler, ...parentIndexes);
  },

  callResolver(ctx, call, onSuccess, onError) {
    let value: unknown;
    try {
      value = call();
    } catch (err) {
      onError(err);
      onSuccess(null);
      return;
    }
    this.handleResolverResult(ctx, value, onSuccess, onError);
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

  finalizeResult(ctx: ExecutionContext): Promise<unknown> | undefined {
    if (ctx.promiseCounter > 0) {
      return new Promise((resolve) => {
        ctx.resolve = resolve;
      });
    }
    return undefined;
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
