import memoize from "lodash.memoize";

type Fn = (...args: any[]) => any;

type Args2<T> = T extends (a: infer A, b: infer B) => infer R
  ? {
      0: A;
      1: B;
      return: R;
    }
  : never;
type Args3<T> = T extends (a: infer A, b: infer B, c: infer C) => infer R
  ? {
      0: A;
      1: B;
      2: C;
      return: R;
    }
  : never;
type Args4<T> = T extends (
  a: infer A,
  b: infer B,
  c: infer C,
  d: infer D
) => infer R
  ? {
      0: A;
      1: B;
      2: C;
      3: D;
      return: R;
    }
  : never;

function uncurry2<A, B, R>(fn: (a: A) => (b: B) => R) {
  return (a: A, b: B) => fn(a)(b);
}

function uncurry3<A, B, C, R>(fn: (a: A) => (b: B) => (c: C) => R) {
  return (a: A, b: B, c: C) => fn(a)(b)(c);
}

function uncurry4<A, B, C, D, R>(
  fn: (a: A) => (b: B) => (c: C) => (d: D) => R
) {
  return (a: A, b: B, c: C, d: D) => fn(a)(b)(c)(d);
}

export function memoize2<T extends Fn>(fn: T): T {
  type A = Args2<T>[0];
  type B = Args2<T>[1];

  return uncurry2(memoize((a: A) => memoize((b: B) => fn(a, b)))) as T;
}

export function memoize3<T extends Fn>(fn: T): T {
  type A = Args3<T>[0];
  type B = Args3<T>[1];
  type C = Args3<T>[2];

  return uncurry3(
    memoize((a: A) => memoize((b: B) => memoize((c: C) => fn(a, b, c))))
  ) as T;
}

export function memoize4<T extends Fn>(fn: T): T {
  type A = Args4<T>[0];
  type B = Args4<T>[1];
  type C = Args4<T>[2];
  type D = Args4<T>[3];

  return uncurry4(
    memoize((a: A) =>
      memoize((b: B) => memoize((c: C) => memoize((d: D) => fn(a, b, c, d))))
    )
  ) as T;
}
