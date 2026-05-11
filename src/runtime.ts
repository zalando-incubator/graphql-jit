import { type ExecutionContext } from "./execution";

type Serializer = (
  c: ExecutionContext,
  v: any,
  onError: any,
  ...idx: number[]
) => any;

function resolvePromise(
  ctx: ExecutionContext,
  promise: Promise<unknown>,
  onSuccess: (result: unknown) => void,
  onError: (err: unknown) => void
): void {
  ++ctx.promiseCounter;
  promise.then(
    (result) => {
      onSuccess(result);
      --ctx.promiseCounter;
      if (ctx.promiseCounter === 0) ctx.resolve!(ctx);
    },
    (err) => {
      onError(err);
      --ctx.promiseCounter;
      if (ctx.promiseCounter === 0) ctx.resolve!(ctx);
    }
  );
}

export const jitRuntime = {
  isPromise(value: unknown): boolean {
    return (
      value != null &&
      typeof value === "object" &&
      typeof (value as any).then === "function"
    );
  },

  checkNonNullLeaf(
    ctx: ExecutionContext,
    value: unknown,
    dest: any[],
    nullMsg: string,
    locs: any,
    path: any,
    capStack: boolean,
    serialize: Serializer,
    errHandler: any,
    ...parentIndexes: number[]
  ): any {
    const GQLError = ctx.GraphQLError as any;
    if (value == null) {
      dest.push(new GQLError(nullMsg, locs, path, undefined, capStack));
      return null;
    }
    if (value instanceof Error) {
      dest.push(
        new GQLError(value.message ?? value, locs, path, value, capStack)
      );
      return null;
    }
    return serialize(ctx, value, errHandler, ...parentIndexes);
  },

  checkNullableLeaf(
    ctx: ExecutionContext,
    value: unknown,
    dest: any[],
    locs: any,
    path: any,
    capStack: boolean,
    serialize: Serializer,
    errHandler: any,
    ...parentIndexes: number[]
  ): any {
    if (value == null) return null;
    const GQLError = ctx.GraphQLError as any;
    if (value instanceof Error) {
      dest.push(
        new GQLError(value.message ?? value, locs, path, value, capStack)
      );
      return null;
    }
    return serialize(ctx, value, errHandler, ...parentIndexes);
  },

  callResolver(
    ctx: ExecutionContext,
    call: () => unknown,
    onSuccess: (result: unknown) => void,
    onError: (err: unknown) => void
  ): void {
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

  handleResolverResult(
    ctx: ExecutionContext,
    value: unknown,
    onSuccess: (result: unknown) => void,
    onError: (err: unknown) => void
  ): void {
    if (this.isPromise(value)) {
      resolvePromise(ctx, value as Promise<unknown>, onSuccess, onError);
    } else {
      onSuccess(value);
    }
  },

  handleListItemResult(
    ctx: ExecutionContext,
    item: unknown,
    onSuccess: (result: unknown) => void,
    onError: (err: unknown) => void
  ): void {
    if (this.isPromise(item)) {
      resolvePromise(ctx, item as Promise<unknown>, onSuccess, onError);
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

  safeMap(
    ctx: ExecutionContext,
    iterable: Iterable<unknown> | string,
    cb: (
      context: ExecutionContext,
      a: unknown,
      index: number,
      resultArray: unknown[],
      ...idx: number[]
    ) => void,
    ...idx: number[]
  ): unknown[] {
    let index = 0;
    const result: unknown[] = [];
    for (const a of iterable as Iterable<unknown>) {
      cb(ctx, a, index, result, ...idx);
      ++index;
    }
    return result;
  }
};

export type JitRuntime = typeof jitRuntime;
