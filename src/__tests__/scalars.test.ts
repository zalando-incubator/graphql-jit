import {
  DocumentNode,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  parse
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
        // v17 built-in scalars implement serialization via
        // `coerceOutputValue`; `serialize` is just an alias assigned at
        // construction time, so spying on it would not observe calls made
        // through `coerceOutputValue`.
        serializeSpy = jest.spyOn(GraphQLString as any, "coerceOutputValue");
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
        expect((GraphQLString as any).coerceOutputValue).toHaveBeenCalledWith(
          "test"
        );
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
        expect(
          (GraphQLString as any).coerceOutputValue
        ).not.toHaveBeenCalledWith("test");
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
        expect(
          (GraphQLString as any).coerceOutputValue
        ).not.toHaveBeenCalledWith("test");
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

describe("Scalars: prefers v17 coercion methods over legacy ones (#296)", () => {
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

  test("uses coerceInputValue (not parseValue) when a variable is coerced", async () => {
    const result = await executeQuery(
      makeSchema(makeCustomScalar()),
      parse("query ($value: Custom) { echo(value: $value) }"),
      undefined,
      { value: "x" }
    );

    expect(result).toEqual({
      data: { echo: "v17-output:v17-input:x" }
    });
  });
});
