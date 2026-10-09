import {
  DocumentNode,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  parse,
  versionInfo
} from "graphql";
import { compileQuery } from "../index";
import SpyInstance = jest.SpyInstance;

function executeQuery(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: any,
  vars?: any
) {
  const prepared: any = compileQuery(schema, document, "");
  return prepared.query(rootValue, undefined, vars);
}

function setupSchema(scalar: GraphQLScalarType, data: any) {
  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: {
        scalar: {
          type: scalar,
          resolve: () => data
        }
      }
    })
  });
}

describe("Scalars: Is able to serialize custom scalar", () => {
  it("serializes the field correctly", async () => {
    const request = `
      {
        scalar
      }
    `;

    const result = await executeQuery(
      setupSchema(
        new GraphQLScalarType({
          name: "Custom",
          serialize: (value: any) => value
        }),
        "test"
      ),
      parse(request)
    );
    expect(result).toEqual({
      data: {
        scalar: "test"
      }
    });
  });

  describe("can handle errors in coercion", () => {
    it("handles the field not being able to coerce", async () => {
      const request = `
      {
        scalar
      }
    `;

      const result = await executeQuery(
        setupSchema(
          new GraphQLScalarType({
            name: "Custom",
            serialize: () => undefined
          }),
          "test"
        ),
        parse(request)
      );
      expect(result).toMatchObject({
        data: {
          scalar: null
        },
        errors: [
          {
            message: `Expected a value of type "Custom" but received: test`,
            path: ["scalar"],
            locations: [{ column: 9, line: 3 }]
          }
        ]
      });
    });
    it("handles the field serializing throwing", async () => {
      const request = `
      {
        scalar
      }
    `;

      const result = await executeQuery(
        setupSchema(
          new GraphQLScalarType({
            name: "Custom",
            serialize: () => {
              throw new Error("failed");
            }
          }),
          "test"
        ),
        parse(request)
      );
      expect(result).toMatchObject({
        data: {
          scalar: null
        },
        errors: [
          {
            message: "failed",
            path: ["scalar"],
            locations: [{ column: 9, line: 3 }]
          }
        ]
      });
    });
    it("handles the field serializing throwing with no error message", async () => {
      const request = `
      {
        scalar
      }
    `;

      const result = await executeQuery(
        setupSchema(
          new GraphQLScalarType({
            name: "Custom",
            serialize: () => {
              throw new Error("");
            }
          }),
          "test"
        ),
        parse(request)
      );
      expect(result).toMatchObject({
        data: {
          scalar: null
        },
        errors: [
          {
            message: `Expected a value of type "Custom" but received an Error`,
            path: ["scalar"],
            locations: [{ column: 9, line: 3 }]
          }
        ]
      });
    });
  });

  describe("can skip serialization", () => {
    test("custom scalar are still supported", () => {
      const spy = jest.fn((value: any) => value);
      const prepared: any = compileQuery(
        setupSchema(
          new GraphQLScalarType({
            name: "Custom",
            serialize: spy
          }),
          "test"
        ),
        parse("{scalar}"),
        "",
        { disableLeafSerialization: true }
      );
      const result = prepared.query(undefined, undefined, {});
      expect(result).toEqual({
        data: {
          scalar: "test"
        }
      });
      expect(spy).toHaveBeenCalledWith("test");
    });

    describe("builtin behaviour", () => {
      let serializeSpy: SpyInstance<any>;
      beforeEach(() => {
        // v17 prefers `coerceOutputValue`; `serialize` is only an alias
        serializeSpy = jest.spyOn(
          GraphQLString as any,
          versionInfo.major >= 17 ? "coerceOutputValue" : "serialize"
        );
      });

      afterEach(() => {
        serializeSpy.mockClear();
      });

      test("builtin scalar are used", () => {
        const prepared: any = compileQuery(
          setupSchema(GraphQLString, "test"),
          parse("{scalar}"),
          "",
          { disableLeafSerialization: false }
        );
        const result = prepared.query(undefined, undefined, {});
        expect(result).toEqual({
          data: {
            scalar: "test"
          }
        });
        expect(serializeSpy).toHaveBeenCalledWith("test");
      });
      test("builtin scalar are skipped", () => {
        const prepared: any = compileQuery(
          setupSchema(GraphQLString, "test"),
          parse("{scalar}"),
          "",
          { disableLeafSerialization: true }
        );
        const result = prepared.query(undefined, undefined, {});
        expect(result).toEqual({
          data: {
            scalar: "test"
          }
        });
        expect(serializeSpy).not.toHaveBeenCalledWith("test");
      });
      test("custom serializer is called", () => {
        const customSerializer = jest.fn(String);
        const prepared: any = compileQuery(
          setupSchema(GraphQLString, "test"),
          parse("{scalar}"),
          "",
          { customSerializers: { String: customSerializer } }
        );
        const result = prepared.query(undefined, undefined, {});
        expect(result).toEqual({
          data: {
            scalar: "test"
          }
        });
        expect(serializeSpy).not.toHaveBeenCalledWith("test");
        expect(customSerializer).toHaveBeenCalledWith("test");
      });
    });
  });
});

describe("Scalars: Is able to deserialize custom scalar", () => {
  it("deserializes Date object scalars properly", async () => {
    const request = `
      {
        scalar(arg: "2022-01-01")
      }
    `;

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          scalar: {
            type: GraphQLString,
            args: {
              arg: {
                type: new GraphQLScalarType({
                  name: "Date",
                  serialize: (value: any) => value.toISOString().slice(0, 10),
                  parseValue: (value: any) => new Date(value),
                  parseLiteral: (ast) =>
                    ast.kind === Kind.STRING ? new Date(ast.value) : null
                })
              }
            },
            resolve: (_parent, { arg }) => Object.prototype.toString.call(arg)
          }
        }
      })
    });

    const result = await executeQuery(schema, parse(request));
    expect(result).toEqual({
      data: {
        scalar: "[object Date]"
      }
    });
  });
});

describe("Scalars: coercion methods when both legacy and v17 APIs are defined (#296)", () => {
  function makeSchema(scalar: GraphQLScalarType) {
    return new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          echo: {
            type: scalar,
            args: { value: { type: scalar } },
            resolve: (_source, args) => args.value
          }
        }
      })
    });
  }

  function makeCustomScalar() {
    return new GraphQLScalarType({
      name: "Custom",
      serialize: (value: any) => `legacy-output:${value}`,
      coerceOutputValue: (value: any) => `v17-output:${value}`,
      parseValue: (value: any) => `legacy-input:${value}`,
      coerceInputValue: (value: any) => `v17-input:${value}`
    } as any);
  }

  // v15/v16 ignore `coerceOutputValue` / `coerceInputValue` in the config
  test("uses the same coercion methods as graphql-js", async () => {
    const result = await executeQuery(
      makeSchema(makeCustomScalar()),
      parse("query ($value: Custom) { echo(value: $value) }"),
      undefined,
      { value: "x" }
    );

    expect(result).toEqual({
      data: {
        echo:
          versionInfo.major >= 17
            ? "v17-output:v17-input:x"
            : "legacy-output:legacy-input:x"
      }
    });
  });
});

describe("custom scalar literals that parse to class instances", () => {
  class Wrapped {
    constructor(public value: string) {}
    toJSON() {
      return this.value;
    }
  }

  const WrappedScalar = new GraphQLScalarType({
    name: "Wrapped",
    serialize: (v: any) => (v instanceof Wrapped ? v.value : String(v)),
    parseValue: (v: any) => new Wrapped(v),
    parseLiteral: (ast: any) => new Wrapped(ast.value)
  });

  const Input = new GraphQLInputObjectType({
    name: "Input",
    fields: { value: { type: new GraphQLNonNull(WrappedScalar) } }
  });

  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: {
        direct: {
          type: GraphQLString,
          args: { value: { type: WrappedScalar } },
          resolve: (_, { value }) =>
            value instanceof Wrapped
              ? `instance:${value.value}`
              : "not-instance"
        },
        nested: {
          type: GraphQLString,
          args: { input: { type: Input } },
          resolve: (_, { input }) =>
            input.value instanceof Wrapped
              ? `instance:${input.value.value}`
              : "not-instance"
        },
        list: {
          type: GraphQLString,
          args: { values: { type: new GraphQLList(WrappedScalar) } },
          resolve: (_, { values }) =>
            values.every((v: unknown) => v instanceof Wrapped)
              ? `instance:${values.map((v: Wrapped) => v.value).join(",")}`
              : "not-instance"
        }
      }
    })
  });

  test.each([
    ['{ direct(value: "a") }', { direct: "instance:a" }],
    ['{ nested(input: { value: "a" }) }', { nested: "instance:a" }],
    ['{ list(values: ["a", "b"]) }', { list: "instance:a,b" }]
  ])("preserves the parseLiteral result for %s", async (query, data) => {
    const result = await executeQuery(schema, parse(query));
    expect(result).toEqual({ data });
  });

  test("returns the same instance for repeated executions", async () => {
    const prepared: any = compileQuery(schema, parse('{ direct(value: "a") }'));
    expect(await prepared.query({}, {}, {})).toEqual({
      data: { direct: "instance:a" }
    });
    expect(await prepared.query({}, {}, {})).toEqual({
      data: { direct: "instance:a" }
    });
  });

  test("does not call toJSON on hoisted values", async () => {
    class Throwing {
      toJSON(): never {
        throw new Error("toJSON must not be called");
      }
    }
    const scalar = new GraphQLScalarType({
      name: "Throwing",
      serialize: () => "ok",
      parseValue: () => new Throwing(),
      parseLiteral: () => new Throwing()
    });
    const throwingSchema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          f: {
            type: GraphQLString,
            args: { value: { type: scalar } },
            resolve: (_, { value }) => String(value instanceof Throwing)
          }
        }
      })
    });
    expect(
      await executeQuery(throwingSchema, parse('{ f(value: "a") }'))
    ).toEqual({ data: { f: "true" } });
  });

  test("preserves Array subclasses", async () => {
    class MyArray extends Array<string> {}
    const scalar = new GraphQLScalarType({
      name: "Arr",
      serialize: () => "ok",
      parseValue: () => MyArray.from(["a"]),
      parseLiteral: () => MyArray.from(["a"])
    });
    const arraySchema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          f: {
            type: GraphQLString,
            args: { value: { type: scalar } },
            resolve: (_, { value }) => String(value instanceof MyArray)
          }
        }
      })
    });
    expect(await executeQuery(arraySchema, parse('{ f(value: "a") }'))).toEqual(
      {
        data: { f: "true" }
      }
    );
  });
});

describe("custom scalar argument values", () => {
  async function resolveLiteral(value: unknown) {
    const scalar = new GraphQLScalarType({
      name: "CustomValue",
      serialize: () => "ok",
      parseValue: () => value,
      parseLiteral: () => value
    });
    const resolve = jest.fn<string, [unknown, { value: unknown }]>(() => "ok");
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          echo: {
            type: GraphQLString,
            args: { value: { type: scalar } },
            resolve
          }
        }
      })
    });
    expect(
      await executeQuery(schema, parse('{ echo(value: "value") }'))
    ).toEqual({
      data: { echo: "ok" }
    });
    return resolve.mock.calls[0][1].value;
  }

  class CustomDate extends Date {}

  test.each([
    ["bigint", BigInt(42)],
    ["symbol", Symbol("value")],
    ["function", () => "value"],
    ["Date subclass", new CustomDate(0)]
  ])("preserves the original %s value", async (_name, value) => {
    expect(await resolveLiteral(value)).toBe(value);
  });

  test("preserves special values in nested objects and arrays", async () => {
    const items = new Array(2);
    items[0] = undefined;
    items.push(NaN, Infinity, -Infinity, new Date(1234));
    const value = {
      nested: { omitted: undefined, nullable: null },
      items
    };

    const resolved: any = await resolveLiteral(value);
    expect(resolved).toEqual({
      nested: { nullable: null },
      items: [undefined, null, NaN, Infinity, -Infinity, new Date(1234)]
    });
    expect(
      Object.prototype.hasOwnProperty.call(resolved.nested, "omitted")
    ).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolved.items, 0)).toBe(true);
  });

  test("preserves an own __proto__ property as an ordinary field", async () => {
    const value = Object.create(null);
    value.__proto__ = { label: "value" };
    value.other = "other";

    const resolved = await resolveLiteral(value);
    expect(Object.getPrototypeOf(resolved)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(resolved, "__proto__")).toBe(
      true
    );
    expect(resolved).toEqual(value);
  });
});
