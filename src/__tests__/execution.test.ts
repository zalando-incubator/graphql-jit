/* eslint-disable prefer-promise-reject-errors */
/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/execution-test.js
 */

import { makeExecutableSchema } from "@graphql-tools/schema";
import {
  DocumentNode,
  ExecutableDefinitionNode,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { CompiledQuery, compileQuery, isCompiledQuery } from "../execution";

function executeArgs(args: any) {
  const {
    schema,
    document,
    rootValue,
    contextValue,
    variableValues,
    operationName
  } = args;
  return executeQuery(
    schema,
    document,
    rootValue,
    contextValue,
    variableValues,
    operationName
  );
}

function executeQuery(
  schema?: GraphQLSchema,
  document?: DocumentNode,
  rootValue?: any,
  contextValue?: any,
  variableValues?: any,
  operationName?: string
) {
  const prepared: any = compileQuery(
    schema as any,
    document as any,
    operationName || ""
  );
  if (!isCompiledQuery(prepared)) {
    return prepared;
  }
  return prepared.query(rootValue, contextValue, variableValues || {});
}

describe("Execute: Handles basic execution tasks", () => {
  test("throws if no document is provided", async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    expect(() => executeQuery(schema)).toThrow("Must provide document.");
  });
  test("throws if no resolve info enricher is not a function", async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    expect(() =>
      compileQuery(schema, parse("{ field }"), "", {
        resolverInfoEnricher: "bad" as any
      })
    ).toThrow("resolverInfoEnricher must be a function");
  });

  test("return the generated function if debug is passed in the options", async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    let compiled: any = compileQuery(schema, parse("{ field }"), "", {
      debug: true
    } as any);

    expect(
      compiled.__DO_NOT_USE_THIS_OR_YOU_WILL_BE_FIRED_compilation
    ).toBeDefined();

    compiled = compileQuery(schema, parse("{ field }"));
    expect(
      compiled.__DO_NOT_USE_THIS_OR_YOU_WILL_BE_FIRED_compilation
    ).not.toBeDefined();
  });

  test("throws if no schema is provided", async () => {
    expect(() =>
      executeArgs({
        document: parse("{ field }")
      })
    ).toThrow("Expected undefined to be a GraphQL schema.");
  });

  test("accepts an object with named properties as arguments", async () => {
    const doc = "query Example { a }";

    const data = "rootValue";

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: {
            type: GraphQLString,
            resolve(rootValue) {
              return rootValue;
            }
          }
        }
      })
    });

    const result = await executeArgs({
      schema,
      document: parse(doc),
      rootValue: data
    });

    expect(result).toEqual({
      data: { a: "rootValue" }
    });
  });

  test("merges parallel fragments", async () => {
    const ast = parse(`
      { a, ...FragOne, ...FragTwo }

      fragment FragOne on Type {
        b
        deep { b, deeper: deep { b } }
      }

      fragment FragTwo on Type {
        c
        deep { c, deeper: deep { c } }
      }
    `);

    const Type: GraphQLObjectType = new GraphQLObjectType({
      name: "Type",
      fields: () => ({
        a: { type: GraphQLString, resolve: () => "Apple" },
        b: { type: GraphQLString, resolve: () => "Banana" },
        c: { type: GraphQLString, resolve: () => "Cherry" },
        deep: { type: Type, resolve: () => ({}) }
      })
    });
    const schema = new GraphQLSchema({ query: Type });

    expect(executeQuery(schema, ast)).toEqual({
      data: {
        a: "Apple",
        b: "Banana",
        c: "Cherry",
        deep: {
          b: "Banana",
          c: "Cherry",
          deeper: {
            b: "Banana",
            c: "Cherry"
          }
        }
      }
    });
  });

  test("provides info about current execution state", async () => {
    const ast = parse("query ($var: String) { result: test }");

    let info: any = {};

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Test",
        fields: {
          test: {
            type: GraphQLString,
            resolve(_: any, _1: any, _2: any, inf: GraphQLResolveInfo) {
              info = inf;
            }
          }
        }
      })
    });

    const rootValue = { root: "val" };

    executeQuery(schema, ast, rootValue, null, { var: "abc" });

    expect(Object.keys(info).sort()).toEqual(
      [
        "fieldName",
        "fieldNodes",
        "returnType",
        "parentType",
        "path",
        "schema",
        "fragments",
        "rootValue",
        "operation",
        "variableValues"
      ].sort()
    );
    expect(info.fieldName).toEqual("test");
    expect(info.fieldNodes).toHaveLength(1);
    expect(info.fieldNodes[0]).toEqual(
      (ast.definitions[0] as ExecutableDefinitionNode).selectionSet
        .selections[0]
    );
    expect(info.returnType).toEqual(GraphQLString);
    expect(info.parentType).toEqual(schema.getQueryType());
    expect(info.path).toEqual({ prev: undefined, key: "result" });
    expect(info.schema).toEqual(schema);
    expect(info.rootValue).toEqual(rootValue);
    expect(info.operation).toEqual(ast.definitions[0]);
    expect(info.variableValues).toEqual({ var: "abc" });
  });

  test("threads root value context correctly", async () => {
    const doc = "query Example { a }";

    const data = {
      contextThing: "thing"
    };

    let resolvedRootValue: any = {};

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: {
            type: GraphQLString,
            resolve(rootValue) {
              resolvedRootValue = rootValue;
            }
          }
        }
      })
    });

    await executeQuery(schema, parse(doc), data);

    expect(resolvedRootValue.contextThing).toEqual("thing");
  });

  test("correctly threads arguments", async () => {
    const doc = `
      query Example {
        b(numArg: 123, stringArg: "foo")
      }
    `;

    let resolvedArgs: any = {};

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          b: {
            args: {
              numArg: { type: GraphQLInt },
              stringArg: { type: GraphQLString }
            },
            type: GraphQLString,
            resolve(_, args) {
              resolvedArgs = args;
            }
          }
        }
      })
    });

    executeQuery(schema, parse(doc));

    expect(resolvedArgs.numArg).toEqual(123);
    expect(resolvedArgs.stringArg).toEqual("foo");
  });

  test("allows NaN/Infinity/-Infinity as arguments", async () => {
    const doc = `
      query Example { b }
    `;

    let resolvedArgs: any = {};

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          b: {
            args: {
              numArg1: { type: GraphQLInt, defaultValue: NaN },
              numArg2: { type: GraphQLInt, defaultValue: NaN },
              numArg3: { type: GraphQLInt, defaultValue: Infinity },
              numArg4: { type: GraphQLInt, defaultValue: Infinity },
              numArg5: { type: GraphQLInt, defaultValue: -Infinity },
              numArg6: { type: GraphQLInt, defaultValue: -Infinity }
            },
            type: GraphQLString,
            resolve(_, args) {
              resolvedArgs = args;
              return "";
            }
          }
        }
      })
    });

    executeQuery(schema, parse(doc));

    expect(resolvedArgs.numArg1).toBeNaN();
    expect(resolvedArgs.numArg2).toBeNaN();
    expect(resolvedArgs.numArg3).toBe(Infinity);
    expect(resolvedArgs.numArg4).toBe(Infinity);
    expect(resolvedArgs.numArg5).toBe(-Infinity);
    expect(resolvedArgs.numArg6).toBe(-Infinity);
  });

  test("nulls out error subtrees", async () => {
    const doc = `{
      sync
      syncError
      syncRawError
      syncReturnError
      syncReturnErrorList
      async
      asyncReject
      asyncRawReject
      asyncEmptyReject
      asyncError
      asyncRawError
      asyncReturnError
      asyncReturnErrorWithExtensions
    }`;

    const data = {
      sync() {
        return "sync";
      },
      syncError() {
        throw new Error("Error getting syncError");
      },
      syncRawError() {
        // eslint-disable-next-line no-throw-literal
        throw new Error("Error getting syncRawError");
      },
      syncReturnError() {
        return new Error("Error getting syncReturnError");
      },
      syncReturnErrorList() {
        return [
          "sync0",
          new Error("Error getting syncReturnErrorList1"),
          "sync2",
          new Error("Error getting syncReturnErrorList3")
        ];
      },
      async() {
        return Promise.resolve("async");
      },
      asyncReject() {
        return Promise.reject(new Error("Error getting asyncReject"));
      },
      asyncRawReject() {
        return Promise.reject("Error getting asyncRawReject");
      },
      asyncEmptyReject() {
        return Promise.reject();
      },
      asyncError() {
        return new Promise(() => {
          throw new Error("Error getting asyncError");
        });
      },
      // eslint-disable-next-line
      asyncRawError() {
        return new Promise(() => {
          /* eslint-disable */
          throw new Error("Error getting asyncRawError");
          /* eslint-enable */
        });
      },
      asyncReturnError() {
        return Promise.resolve(new Error("Error getting asyncReturnError"));
      },
      asyncReturnErrorWithExtensions() {
        const error: any = new Error(
          "Error getting asyncReturnErrorWithExtensions"
        );
        error.extensions = { foo: "bar" };

        return Promise.resolve(error);
      }
    };

    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          sync: {
            type: GraphQLString,
            resolve(data) {
              return data.sync();
            }
          },
          syncError: {
            type: GraphQLString,
            resolve(data) {
              return data.syncError();
            }
          },
          syncRawError: {
            type: GraphQLString,
            resolve(data) {
              return data.syncRawError();
            }
          },
          syncReturnError: {
            type: GraphQLString,
            resolve(data) {
              return data.syncReturnError();
            }
          },
          syncReturnErrorList: {
            type: new GraphQLList(GraphQLString),
            resolve(data) {
              return data.syncReturnErrorList();
            }
          },
          async: {
            type: GraphQLString,
            resolve(data) {
              return data.async();
            }
          },
          asyncReject: {
            type: GraphQLString,
            resolve(data) {
              return data.asyncReject();
            }
          },
          asyncRawReject: {
            type: GraphQLString,
            resolve(data) {
              return data.asyncRawReject();
            }
          },
          asyncEmptyReject: {
            type: GraphQLString,
            resolve(data) {
              return data.asyncEmptyReject();
            }
          },
          asyncError: {
            type: GraphQLString,
            resolve(data) {
              return data.asyncError();
            }
          },
          asyncRawError: {
            type: GraphQLString,
            resolve(data) {
              return data.asyncRawError();
            }
          },
          asyncReturnError: {
            type: GraphQLString,
            resolve(data) {
              return data.asyncReturnError();
            }
          },
          asyncReturnErrorWithExtensions: {
            type: GraphQLString,
            resolve(data) {
              return data.asyncReturnErrorWithExtensions();
            }
          }
        }
      })
    });

    const result = await executeQuery(schema, ast, data);

    expect(result).toMatchObject({
      data: {
        sync: "sync",
        syncError: null,
        syncRawError: null,
        syncReturnError: null,
        syncReturnErrorList: ["sync0", null, "sync2", null],
        async: "async",
        asyncReject: null,
        asyncRawReject: null,
        asyncEmptyReject: null,
        asyncError: null,
        asyncRawError: null,
        asyncReturnError: null,
        asyncReturnErrorWithExtensions: null
      },
      errors: [
        {
          message: "Error getting syncError",
          locations: [{ line: 3, column: 7 }],
          path: ["syncError"]
        },
        {
          message: "Error getting syncRawError",
          locations: [{ line: 4, column: 7 }],
          path: ["syncRawError"]
        },
        {
          message: "Error getting syncReturnError",
          locations: [{ line: 5, column: 7 }],
          path: ["syncReturnError"]
        },
        {
          message: "Error getting syncReturnErrorList1",
          locations: [{ line: 6, column: 7 }],
          path: ["syncReturnErrorList", 1]
        },
        {
          message: "Error getting syncReturnErrorList3",
          locations: [{ line: 6, column: 7 }],
          path: ["syncReturnErrorList", 3]
        },
        {
          message: "Error getting asyncReject",
          locations: [{ line: 8, column: 7 }],
          path: ["asyncReject"]
        },
        {
          message: "Error getting asyncRawReject",
          locations: [{ line: 9, column: 7 }],
          path: ["asyncRawReject"]
        },
        {
          message: "",
          locations: [{ line: 10, column: 7 }],
          path: ["asyncEmptyReject"]
        },
        {
          message: "Error getting asyncError",
          locations: [{ line: 11, column: 7 }],
          path: ["asyncError"]
        },
        {
          message: "Error getting asyncRawError",
          locations: [{ line: 12, column: 7 }],
          path: ["asyncRawError"]
        },
        {
          message: "Error getting asyncReturnError",
          locations: [{ line: 13, column: 7 }],
          path: ["asyncReturnError"]
        },
        {
          message: "Error getting asyncReturnErrorWithExtensions",
          locations: [{ line: 14, column: 7 }],
          path: ["asyncReturnErrorWithExtensions"],
          extensions: { foo: "bar" }
        }
      ]
    });
  });

  test("nulls error subtree for promise rejection #1071", async () => {
    const query = `
      query {
        foods {
          name
        }
      }
    `;

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          foods: {
            type: new GraphQLList(
              new GraphQLObjectType({
                name: "Food",
                fields: {
                  name: { type: GraphQLString }
                }
              })
            ),
            resolve() {
              return Promise.reject(new Error("Dangit"));
            }
          }
        }
      })
    });

    const ast = parse(query);
    const result = await executeQuery(schema, ast);

    expect(result).toMatchObject({
      data: {
        foods: null
      },
      errors: [
        {
          locations: [
            {
              column: 9,
              line: 3
            }
          ],
          message: "Dangit",
          path: ["foods"]
        }
      ]
    });
  });

  test("Full response path is included for non-nullable fields", async () => {
    const A: GraphQLObjectType = new GraphQLObjectType({
      name: "A",
      fields: () => ({
        nullableA: {
          type: A,
          resolve: () => ({})
        },
        nonNullA: {
          type: new GraphQLNonNull(A),
          resolve: () => ({})
        },
        throws: {
          type: new GraphQLNonNull(GraphQLString),
          resolve: () => {
            throw new Error("Catch me if you can");
          }
        }
      })
    });
    const queryType = new GraphQLObjectType({
      name: "query",
      fields: () => ({
        nullableA: {
          type: A,
          resolve: () => ({})
        }
      })
    });
    const schema = new GraphQLSchema({
      query: queryType
    });

    const query = `
      query {
        nullableA {
          aliasedA: nullableA {
            nonNullA {
              anotherA: nonNullA {
                throws
              }
            }
          }
        }
      }
    `;

    const result = await executeQuery(schema, parse(query));
    expect(result).toMatchObject({
      data: {
        nullableA: {
          aliasedA: null
        }
      },
      errors: [
        {
          message: "Catch me if you can",
          locations: [{ line: 7, column: 17 }],
          path: ["nullableA", "aliasedA", "nonNullA", "anotherA", "throws"]
        }
      ]
    });
  });

  test("uses the inline operation if no operation name is provided", async () => {
    const doc = "{ a }";
    const data = { a: "b" };
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    const result = await executeQuery(schema, ast, data);

    expect(result).toEqual({ data: { a: "b" } });
  });

  // eslint-disable-next-line
  test("uses the only operation if no operation name is provided", async () => {
    const doc = "query Example { a }";
    const data = { a: "b" };
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    const result = await executeQuery(schema, ast, data);

    expect(result).toEqual({ data: { a: "b" } });
  });

  test("uses the named operation if operation name is provided", async () => {
    const doc = "query Example { first: a } query OtherExample { second: a }";
    const data = { a: "b" };
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    const result = await executeQuery(
      schema,
      ast,
      data,
      null,
      null,
      "OtherExample"
    );

    expect(result).toEqual({ data: { second: "b" } });
  });

  test("provides error if no operation is provided", async () => {
    const doc = "fragment Example on Type { a }";
    const data = { a: "b" };
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    expect(executeQuery(schema, ast, data)).toMatchObject({
      errors: [{ message: "Must provide an operation." }]
    });
  });

  // eslint-disable-next-line
  test("errors if no op name is provided with multiple operations", async () => {
    const doc = "query Example { a } query OtherExample { a }";
    const data = { a: "b" };
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    expect(executeQuery(schema, ast, data)).toMatchObject({
      errors: [
        {
          message:
            "Must provide operation name if query contains multiple operations."
        }
      ]
    });
  });

  test("errors if unknown operation name is provided", async () => {
    const doc = "query Example { a } query OtherExample { a }";
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    expect(
      executeArgs({
        schema,
        document: ast,
        operationName: "UnknownExample"
      })
    ).toMatchObject({
      errors: [{ message: 'Unknown operation named "UnknownExample".' }]
    });
  });

  test("uses the query schema for queries", async () => {
    const doc = "query Q { a } mutation M { c } subscription S { a }";
    const data = { a: "b", c: "d" };
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Q",
        fields: {
          a: { type: GraphQLString }
        }
      }),
      mutation: new GraphQLObjectType({
        name: "M",
        fields: {
          c: { type: GraphQLString }
        }
      }),
      subscription: new GraphQLObjectType({
        name: "S",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    const queryResult = await executeQuery(schema, ast, data, null, {}, "Q");

    expect(queryResult).toEqual({ data: { a: "b" } });
  });

  test("uses the mutation schema for mutations", async () => {
    const doc = "query Q { a } mutation M { c }";
    const data = { a: "b", c: "d" };
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Q",
        fields: {
          a: { type: GraphQLString }
        }
      }),
      mutation: new GraphQLObjectType({
        name: "M",
        fields: {
          c: { type: GraphQLString }
        }
      })
    });

    const mutationResult = await executeQuery(schema, ast, data, null, {}, "M");

    expect(mutationResult).toEqual({ data: { c: "d" } });
  });

  test("uses the subscription schema for subscriptions", async () => {
    const doc = "query Q { a } subscription S { a }";
    const data = { a: "b", c: "d" };
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Q",
        fields: {
          a: { type: GraphQLString }
        }
      }),
      subscription: new GraphQLObjectType({
        name: "S",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    const subscriptionResult = await executeQuery(
      schema,
      ast,
      data,
      null,
      {},
      "S"
    );

    expect(subscriptionResult).toEqual({ data: { a: "b" } });
  });

  test("correct field ordering despite execution order", async () => {
    const doc = `{
      a,
      b,
      c,
      d,
      e
    }`;

    const data = {
      a() {
        return "a";
      },
      b() {
        return Promise.resolve("b");
      },
      c() {
        return "c";
      },
      d() {
        return Promise.resolve("d");
      },
      e() {
        return "e";
      }
    };

    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: {
            type: GraphQLString,
            resolve(data) {
              return data.a();
            }
          },
          b: {
            type: GraphQLString,
            resolve(data) {
              return data.b();
            }
          },
          c: {
            type: GraphQLString,
            resolve(data) {
              return data.c();
            }
          },
          d: {
            type: GraphQLString,
            resolve(data) {
              return data.d();
            }
          },
          e: {
            type: GraphQLString,
            resolve(data) {
              return data.e();
            }
          }
        }
      })
    });

    const result: any = await executeQuery(schema, ast, data);

    expect(result).toEqual({
      data: {
        a: "a",
        b: "b",
        c: "c",
        d: "d",
        e: "e"
      }
    });

    expect(Object.keys(result.data)).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("Avoids recursion", async () => {
    const doc = `
      query Q {
        a
        ...Frag
        ...Frag
      }

      fragment Frag on Type {
        a,
        ...Frag
      }
    `;
    const data = { a: "b" };
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });

    const queryResult = await executeQuery(schema, ast, data, null, {}, "Q");

    expect(queryResult).toEqual({ data: { a: "b" } });
  });

  test("does not include illegal fields in output", async () => {
    const doc = `mutation M {
      thisIsIllegalDontIncludeMe
    }`;
    const ast = parse(doc);
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Q",
        fields: {
          a: { type: GraphQLString }
        }
      }),
      mutation: new GraphQLObjectType({
        name: "M",
        fields: {
          c: { type: GraphQLString }
        }
      })
    });

    const mutationResult = await executeQuery(schema, ast);

    expect(mutationResult).toEqual({
      data: {}
    });
  });

  test("does not include arguments that were not set", async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          field: {
            type: GraphQLString,
            resolve: (_, args) => args && JSON.stringify(args),
            args: {
              a: { type: GraphQLBoolean },
              b: { type: GraphQLBoolean },
              c: { type: GraphQLBoolean },
              d: { type: GraphQLInt },
              e: { type: GraphQLInt }
            }
          }
        }
      })
    });

    const query = parse("{ field(a: true, c: false, e: 0) }");
    const result = await executeQuery(schema, query);

    expect(result).toEqual({
      data: {
        field: '{"a":true,"c":false,"e":0}'
      }
    });
  });

  it("fails when an isTypeOf check is not met", async () => {
    class Special {
      // eslint-disable-next-line no-useless-constructor
      constructor(public value: any) {}
    }

    class NotSpecial {
      // eslint-disable-next-line no-useless-constructor
      constructor(public value: any) {}
    }

    const SpecialType = new GraphQLObjectType({
      name: "SpecialType",
      isTypeOf(obj) {
        return obj instanceof Special;
      },
      fields: {
        value: { type: GraphQLString }
      }
    });

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          special: {
            type: SpecialType,
            resolve: (rootValue) => rootValue.special
          },
          specials: {
            type: new GraphQLList(SpecialType),
            resolve: (rootValue) => rootValue.specials
          }
        }
      })
    });

    const query = parse("{ special {value} specials { value } }");
    const value = {
      special: new NotSpecial("bar"),
      specials: [new Special("foo"), new NotSpecial("bar")]
    };
    const result = await executeQuery(schema, query, value);

    expect(result).toMatchObject({
      data: {
        special: null,
        specials: [{ value: "foo" }, null]
      },
      errors: [
        {
          message:
            'Expected value of type "SpecialType" but got: { value: "bar" }.',
          locations: [{ line: 1, column: 3 }],
          path: ["special"]
        },
        {
          message:
            'Expected value of type "SpecialType" but got: { value: "bar" }.',
          locations: [{ line: 1, column: 19 }],
          path: ["specials", 1]
        }
      ]
    });
  });

  test("executes ignoring invalid non-executable definitions", async () => {
    const query = parse(`
      { foo }

      type Query { bar: String }
    `);

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          foo: {
            type: GraphQLString,
            resolve() {
              return null;
            }
          }
        }
      })
    });

    const result = await executeQuery(schema, query, null);
    expect(result).toEqual({
      data: {
        foo: null
      }
    });
  });

  test("allow for 'parent' field name", async () => {
    const query = parse(`{ parent }`);

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          parent: {
            type: GraphQLString,
            resolve() {
              return "works";
            }
          }
        }
      })
    });

    const result = await executeQuery(schema, query, null);
    expect(result).toEqual({
      data: {
        parent: "works"
      }
    });
  });

  test("should allow js keywords in field names", () => {
    const rootValue = {
      import: {
        export: "export",
        var: "var"
      },
      async: {
        await: {
          import: {
            export: "export",
            var: "var"
          }
        },
        for: "for",
        const: "const"
      }
    };

    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          import: Import
          async: Async
        }
        type Async {
          await: Await
          for: String
          const: String
        }
        type Await {
          import: Import
        }
        type Import {
          export: String
          var: String
        }
      `,
      resolvers: {}
    });

    const query = `
      query {
        import {
          export
          var
        }
        async {
          await {
            import {
              export
              var
            }
          }
          for
          const
        }
      }
    `;

    const result = executeQuery(schema, parse(query), rootValue);
    expect(result.data).toEqual(expect.objectContaining(rootValue));
  });
});

describe("Checks if the output of the compilation was a compiled query", () => {
  test("returns false for Execution Result", () => {
    expect(isCompiledQuery({ errors: [] })).toBeFalsy();
  });
  test("returns true for a compiled query object", () => {
    expect(
      isCompiledQuery({
        query: jest.fn() as unknown as CompiledQuery["query"],
        stringify: JSON.stringify
      })
    ).toBeTruthy();
  });
});

describe("dx", () => {
  test("function name of the bound query", async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Type",
        fields: {
          a: { type: GraphQLString }
        }
      })
    });
    const document = parse(`query mockOperationName { a }`);
    const compiledQuery = compileQuery(schema, document) as CompiledQuery;
    expect(isCompiledQuery(compiledQuery)).toBe(true);
    expect(compiledQuery.query.name).toBe("mockOperationName");
  });
});
