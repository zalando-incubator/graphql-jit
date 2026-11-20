import {
  type GraphQLInputType,
  isInputObjectType,
  isLeafType,
  isListType,
  isNonNullType
} from "graphql";

/**
 * A custom scalar literal from the document that parses to an object.
 *
 * GraphQL-JS parses literals on every execution, so each resolver call gets
 * its own value. A value parsed at compile time would instead be shared by
 * every execution of the compiled query, and a resolver that mutates it would
 * change it for the following executions.
 *
 * The literal is parsed twice when compiling, and `value` and `again` are the
 * results. `compileInputValue` emits a copy of `value` when `compileCopy` can
 * make one, and otherwise a call to `parse`, which parses the literal again and
 * returns undefined if it is invalid.
 */
export class ScalarLiteral {
  constructor(
    readonly value: unknown,
    readonly again: unknown,
    readonly parse: () => unknown
  ) {}
}

/** Whether a value can be mutated, so that it must not be shared. */
export function isMutable(value: unknown): boolean {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

type Bind = (value: unknown) => string;

/**
 * Emits a coerced input value as a JS expression. Lists and input objects are
 * emitted inline, so every execution gets fresh containers that variables can
 * be written into. Scalar and enum values are internal values that need not be
 * serializable (bigint, Date, class instances...), so non-primitive ones are
 * stored outside the source with `bind`, which returns the expression to read
 * them back. A `ScalarLiteral` is copied with `compileCopy` if it can be, and
 * otherwise emitted by `parseLiteral`.
 */
export function compileInputValue(
  val: any,
  type: GraphQLInputType,
  bind: Bind,
  parseLiteral?: (literal: ScalarLiteral) => string
): string {
  return compileInput(val, val, type, bind, (value) => {
    if (!(value instanceof ScalarLiteral)) {
      return compileShared(value, bind);
    }
    const copy = compileCopy(value.value, value.again, bind);
    if (copy !== undefined) {
      return copy;
    }
    /* istanbul ignore if */
    if (!parseLiteral) {
      throw new Error("Unexpected custom scalar literal.");
    }
    return parseLiteral(value);
  });
}

/**
 * Like `compileInputValue`, for a value coerced from a literal: `value` and
 * `again` are the results of coercing it twice. Returns undefined if a scalar
 * value cannot be copied with `compileCopy`, in which case the literal has to
 * be coerced again for every execution.
 */
export function compileInputCopy(
  value: unknown,
  again: unknown,
  type: GraphQLInputType,
  bind: Bind
): string | undefined {
  let copied = true;
  const source = compileInput(value, again, type, bind, (leaf, leafAgain) => {
    const copy = compileCopy(leaf, leafAgain, bind);
    if (copy === undefined) {
      copied = false;
      return "";
    }
    return copy;
  });
  return copied ? source : undefined;
}

function compileInput(
  val: any,
  again: any,
  type: GraphQLInputType,
  bind: Bind,
  compileLeaf: (value: unknown, again: unknown) => string
): string {
  if (val == null) {
    return String(val);
  }
  if (isNonNullType(type)) {
    return compileInput(val, again, type.ofType, bind, compileLeaf);
  }
  if (isLeafType(type)) {
    return compileLeaf(val, again);
  }
  if (isListType(type)) {
    if (Object.getPrototypeOf(val) !== Array.prototype) {
      // a programmatic default that is not a plain array, e.g. an array
      // subclass, is passed as is, like GraphQL.js does
      return bind(val);
    }
    return `[${val
      .map((item: unknown, i: number) =>
        compileInput(item, again?.[i], type.ofType, bind, compileLeaf)
      )
      .join(",")}]`;
  }
  if (isInputObjectType(type)) {
    const proto = Object.getPrototypeOf(val);
    if (proto !== Object.prototype && proto !== null) {
      // a programmatic default that is a class instance is passed as is,
      // like GraphQL.js does
      return bind(val);
    }
    const fields = type.getFields();
    const props = [];
    for (const key of Object.keys(val)) {
      // unknown keys of a programmatic default are passed as is
      const value = fields[key]
        ? compileInput(
            val[key],
            again?.[key],
            fields[key].type,
            bind,
            compileLeaf
          )
        : bind(val[key]);
      props.push(`${JSON.stringify(key)}:${value}`);
    }
    return `{${props.join(",")}}`;
  }
  /* istanbul ignore next */
  throw new Error(`Unexpected input type: "${type}".`);
}

/**
 * Emits a value that every execution shares: primitives are inlined and other
 * values are bound.
 */
function compileShared(value: unknown, bind: Bind): string {
  switch (typeof value) {
    case "number":
      if (Object.is(value, -0)) {
        return "-0";
      }
      // JSON.stringify would turn NaN/Infinity into null
      return Number.isFinite(value) ? JSON.stringify(value) : String(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "undefined":
      return "undefined";
    default:
      return value === null ? "null" : bind(value);
  }
}

/**
 * Emits an expression that builds a value parsed from a literal, given `a`
 * and `b`, the results of parsing it twice.
 *
 * What is the same in both is what parsing returns every time: it is shared,
 * as GraphQL-JS shares it too. Objects that parsing creates anew are copied
 * when they are dates, arrays or plain objects with plain data properties, so
 * that every execution gets its own without parsing again. Returns undefined
 * for any other object, such as a class instance, and when `a` and `b`
 * differ.
 */
function compileCopy(a: unknown, b: unknown, bind: Bind): string | undefined {
  const copied = new Set<object>();

  function copy(a: unknown, b: unknown): string | undefined {
    if (Object.is(a, b)) {
      return compileShared(a, bind);
    }
    if (
      typeof a !== "object" ||
      a === null ||
      typeof b !== "object" ||
      b === null ||
      // an object found twice would be copied twice
      copied.has(a) ||
      copied.has(b)
    ) {
      return undefined;
    }
    copied.add(a);
    copied.add(b);
    const proto = Object.getPrototypeOf(a);
    const keys = Reflect.ownKeys(a);
    if (
      proto !== Object.getPrototypeOf(b) ||
      !Object.isExtensible(a) ||
      !Object.isExtensible(b) ||
      !sameKeys(keys, Reflect.ownKeys(b))
    ) {
      return undefined;
    }
    if (proto === Date.prototype) {
      const time = (a as Date).getTime();
      return keys.length === 0 && Object.is(time, (b as Date).getTime())
        ? `new Date(${time})`
        : undefined;
    }
    if (proto === Array.prototype) {
      const length = (a as unknown[]).length;
      // holes and properties other than items and length are not copied
      if (keys.length !== length + 1) {
        return undefined;
      }
      const items = [];
      for (let i = 0; i < length; i++) {
        const item = copyProperty(a, b, String(i));
        if (item === undefined) {
          return undefined;
        }
        items.push(item);
      }
      return `[${items.join(",")}]`;
    }
    if (proto === Object.prototype || proto === null) {
      const props = proto === null ? ["__proto__:null"] : [];
      for (const key of keys) {
        if (typeof key !== "string") {
          return undefined;
        }
        const value = copyProperty(a, b, key);
        if (value === undefined) {
          return undefined;
        }
        // a quoted "__proto__" key would set the prototype
        const name =
          key === "__proto__" ? '["__proto__"]' : JSON.stringify(key);
        props.push(`${name}:${value}`);
      }
      return `{${props.join(",")}}`;
    }
    return undefined;
  }

  function copyProperty(a: object, b: object, key: string): string | undefined {
    const da = Object.getOwnPropertyDescriptor(a, key);
    const db = Object.getOwnPropertyDescriptor(b, key);
    if (!isPlainData(da) || !isPlainData(db)) {
      return undefined;
    }
    return copy(da.value, db.value);
  }

  return copy(a, b);
}

/** Whether a property is one that an object or array literal creates. */
function isPlainData(
  descriptor: PropertyDescriptor | undefined
): descriptor is PropertyDescriptor {
  return (
    descriptor !== undefined &&
    "value" in descriptor &&
    descriptor.writable === true &&
    descriptor.enumerable === true &&
    descriptor.configurable === true
  );
}

function sameKeys(
  a: ReadonlyArray<string | symbol>,
  b: ReadonlyArray<string | symbol>
): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}
