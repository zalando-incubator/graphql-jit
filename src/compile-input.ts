import {
  type GraphQLInputType,
  isInputObjectType,
  isLeafType,
  isListType,
  isNonNullType
} from "graphql";

/**
 * Emits a coerced input value as a JS expression. Lists and input objects are
 * emitted inline, so every execution gets fresh containers that variables can
 * be written into. Scalar and enum values are internal values that need not be
 * serializable (bigint, Date, class instances...), so non-primitive ones are
 * stored outside the source with `bind`, which returns the expression to read
 * them back.
 */
export function compileInputValue(
  val: any,
  type: GraphQLInputType,
  bind: (value: any) => string
): string {
  if (val == null) {
    return String(val);
  }
  if (isNonNullType(type)) {
    return compileInputValue(val, type.ofType, bind);
  }
  if (isLeafType(type)) {
    switch (typeof val) {
      case "number":
        // JSON.stringify would turn NaN/Infinity into null
        return Number.isFinite(val) ? JSON.stringify(val) : String(val);
      case "string":
      case "boolean":
        return JSON.stringify(val);
      default:
        return bind(val);
    }
  }
  if (isListType(type)) {
    if (Object.getPrototypeOf(val) !== Array.prototype) {
      // a programmatic default that is not a plain array, e.g. an array
      // subclass, is passed as is, like GraphQL.js does
      return bind(val);
    }
    return `[${val
      .map((item: unknown) => compileInputValue(item, type.ofType, bind))
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
        ? compileInputValue(val[key], fields[key].type, bind)
        : bind(val[key]);
      props.push(`${JSON.stringify(key)}:${value}`);
    }
    return `{${props.join(",")}}`;
  }
  /* istanbul ignore next */
  throw new Error(`Unexpected input type: "${type}".`);
}
