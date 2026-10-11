import {
  DocumentNode,
  GraphQLInputObjectType,
  type GraphQLInputType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  execute,
  parse,
  versionInfo
} from "graphql";
import { compileQuery, isCompiledQuery } from "../index";
import SpyInstance = jest.SpyInstance;

describe("programmatic argument defaults", () => {
  const objectType = new GraphQLInputObjectType({
    name: "DefaultObject",
    fields: { known: { type: GraphQLString } }
  });
  const cases: [string, GraphQLInputType, unknown, string][] = [
    ["non-array list", new GraphQLList(GraphQLString), "a", '"a"'],
    [
      "input object with an extra key",
      objectType,
      { known: "a", extra: "b" },
      '{"known":"a","extra":"b"}'
    ]
  ];

  describe.each(["argument", "input field"])("%s defaults", (location) => {
    test.each(cases)(
      "preserves a %s default",
      async (_name, type, value, expected) => {
        const wrapper = new GraphQLInputObjectType({
          name: "DefaultWrapper",
          fields: { value: { type, defaultValue: value } }
        });
        const schema = new GraphQLSchema({
          query: new GraphQLObjectType({
            name: "Query",
            fields: {
              echo: {
                type: GraphQLString,
                args:
                  location === "argument"
                    ? { value: { type, defaultValue: value } }
                    : { input: { type: wrapper } },
                resolve: (_source, args) => {
                  const resolved =
                    location === "argument" ? args.value : args.input.value;
                  return Array.isArray(resolved)
                    ? `length:${resolved.length}`
                    : JSON.stringify(resolved);
                }
              }
            }
          })
        });
        const document = parse(
          location === "argument" ? "{ echo }" : "{ echo(input: {}) }"
        );
        const reference = await execute({ schema, document });
        expect(reference).toEqual({ data: { echo: expected } });
        const prepared = compileQuery(schema, document);
        expect(
          isCompiledQuery(prepared)
            ? await prepared.query(undefined, undefined, {})
            : prepared
        ).toEqual(reference);
      }
    );
  });
});

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
    expect(resolved).toBe(value);
    expect(
      Object.prototype.hasOwnProperty.call(resolved.nested, "omitted")
    ).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(resolved.items, 0)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(resolved.items, 1)).toBe(false);
  });

  test("preserves an own __proto__ property as an ordinary field", async () => {
    const value = Object.create(null);
    value.__proto__ = { label: "value" };
    value.other = "other";

    const resolved = await resolveLiteral(value);
    expect(Object.getPrototypeOf(resolved)).toBe(null);
    expect(Object.prototype.hasOwnProperty.call(resolved, "__proto__")).toBe(
      true
    );
    expect(resolved).toEqual(value);
  });
});

test("preserves nested scalar literals while inserting variables into fresh input containers", async () => {
  const brand = Symbol("brand");
  const scalar = new GraphQLScalarType({
    name: "Branded",
    parseValue: (value) => ({ [brand]: String(value) }),
    parseLiteral: (node) => {
      if (node.kind !== Kind.STRING) {
        throw new Error("Expected a string");
      }
      return { [brand]: node.value };
    },
    serialize: (value: any) => value[brand]
  });
  const inputType = new GraphQLInputObjectType({
    name: "BrandedInput",
    fields: {
      value: { type: new GraphQLNonNull(scalar) },
      values: { type: new GraphQLList(new GraphQLNonNull(scalar)) },
      label: { type: GraphQLString }
    }
  });
  const inputs: any[] = [];
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: {
        echo: {
          type: GraphQLString,
          args: { input: { type: inputType } },
          resolve: (_source, { input }) => {
            inputs.push(input);
            return `${input.value[brand]}:${input.values
              .map((value: any) => value[brand])
              .join(",")}:${input.label}`;
          }
        }
      }
    })
  });
  const document = parse(`
    query ($value: Branded!, $label: String) {
      echo(input: { value: "a", values: ["b", $value], label: $label })
    }
  `);
  const prepared = compileQuery(schema, document);
  expect(prepared).not.toHaveProperty("errors");
  if (!isCompiledQuery(prepared)) {
    return;
  }
  for (const label of ["first", "second"]) {
    const variableValues = { value: label, label };
    const reference = await execute({ schema, document, variableValues });
    expect(reference).toEqual({ data: { echo: `a:b,${label}:${label}` } });
    expect(await prepared.query(undefined, undefined, variableValues)).toEqual(
      reference
    );
  }
  // GraphQL.js and JIT each resolve once per execution.
  expect(inputs[1].label).toBe("first");
  expect(inputs[1].values[1][brand]).toBe("first");
  expect(inputs[3]).not.toBe(inputs[1]);
  expect(inputs[3].values).not.toBe(inputs[1].values);
});

describe.each([
  ["literal", '{ echo(value: "value") }', undefined],
  [
    "variable",
    "query ($value: Opaque) { echo(value: $value) }",
    { value: "value" }
  ]
])("opaque custom scalar %s round trips", (_name, query, variableValues) => {
  async function expectRoundTrip<T>(
    createValue: () => T,
    serialize: (value: T) => string,
    expected: string
  ) {
    const scalar = new GraphQLScalarType({
      name: "Opaque",
      parseValue: () => createValue(),
      parseLiteral: () => createValue(),
      serialize: (value) => serialize(value as T)
    });
    const schema = new GraphQLSchema({
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
    const document = parse(query);
    const reference = await execute({ schema, document, variableValues });
    expect(reference).toEqual({ data: { echo: expected } });

    const prepared = compileQuery(schema, document);
    const result = isCompiledQuery(prepared)
      ? await prepared.query(undefined, undefined, variableValues)
      : prepared;
    expect(result).toEqual(reference);
  }

  test("preserves symbol properties used by output coercion", async () => {
    const brand = Symbol("brand");
    await expectRoundTrip(
      () => ({ [brand]: "value" }),
      (value) => value[brand] ?? "missing brand",
      "value"
    );
  });

  test("accepts circular internal values with valid output coercion", async () => {
    interface CircularValue {
      value: string;
      self?: CircularValue;
    }
    await expectRoundTrip(
      () => {
        const value: CircularValue = { value: "value" };
        value.self = value;
        return value;
      },
      (value) => value.self?.value ?? "missing self",
      "value"
    );
  });

  test("leaves getter evaluation to output coercion", async () => {
    await expectRoundTrip(
      () => {
        let reads = 0;
        return {
          get value() {
            return ++reads;
          }
        };
      },
      (value) => String(value.value),
      "1"
    );
  });
});
