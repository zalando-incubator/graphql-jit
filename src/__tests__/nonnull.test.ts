/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/nonnull-test.js
 */

import {
  DocumentNode,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { compileQuery } from "../index";

const syncError = new Error("sync");
const syncNonNullError = new Error("syncNonNull");
const promiseError = new Error("promise");
const promiseNonNullError = new Error("promiseNonNull");

const throwingData = {
  sync() {
    throw syncError;
  },
  syncNonNull() {
    throw syncNonNullError;
  },
  promise() {
    return new Promise(() => {
      throw promiseError;
    });
  },
  promiseNonNull() {
    return new Promise(() => {
      throw promiseNonNullError;
    });
  },
  syncNest() {
    return throwingData;
  },
  syncNonNullNest() {
    return throwingData;
  },
  promiseNest() {
    return Promise.resolve(throwingData);
  },
  promiseNonNullNest() {
    return Promise.resolve(throwingData);
  }
};

const nullingData = {
  sync() {
    return null;
  },
  syncNonNull() {
    return null;
  },
  promise() {
    return Promise.resolve(null);
  },
  promiseNonNull() {
    return Promise.resolve(null);
  },
  syncNest() {
    return nullingData;
  },
  syncNonNullNest() {
    return nullingData;
  },
  promiseNest() {
    return Promise.resolve(nullingData);
  },
  promiseNonNullNest() {
    return Promise.resolve(nullingData);
  }
};

const dataType: GraphQLObjectType = new GraphQLObjectType({
  name: "DataType",
  fields: () => ({
    sync: { type: GraphQLString, resolve: (root: any) => root.sync() },
    syncNonNull: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (root: any) => root.syncNonNull()
    },
    promise: { type: GraphQLString, resolve: (root: any) => root.promise() },
    promiseNonNull: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (root: any) => root.promiseNonNull()
    },
    syncNest: { type: dataType, resolve: (root: any) => root.syncNest() },
    syncNonNullNest: {
      type: new GraphQLNonNull(dataType),
      resolve: (root: any) => root.syncNonNullNest()
    },
    promiseNest: { type: dataType, resolve: (root: any) => root.promiseNest() },
    promiseNonNullNest: {
      type: new GraphQLNonNull(dataType),
      resolve: (root: any) => root.promiseNonNullNest()
    }
  })
});
const schema = new GraphQLSchema({
  query: dataType
});

function executeQuery(query: string, rootValue: any) {
  return doExecute(schema, parse(query), rootValue);
}

function executeArgs(args: any) {
  const {
    schema: schema1,
    document,
    rootValue,
    contextValue,
    variableValues,
    operationName
  } = args;
  return doExecute(
    schema1,
    document,
    rootValue,
    contextValue,
    variableValues,
    operationName
  );
}

function doExecute(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue: any,
  contextValue?: any,
  variableValues?: any,
  operationName?: string
) {
  const prepared: any = compileQuery(schema, document, operationName || "");
  if (prepared.errors) {
    return prepared;
  }
  return prepared.query(rootValue, contextValue, variableValues || {});
}

// avoids also doing any nests
function patch(data: any) {
  return JSON.parse(
    JSON.stringify(data)
      .replace(/\bsync\b/g, "promise")
      .replace(/\bsyncNonNull\b/g, "promiseNonNull")
  );
}

// tslint:disable-next-line
async function executeSyncAndAsync(query: string, rootValue: any) {
  const syncResult = await executeQuery(query, rootValue);
  const asyncResult = await executeQuery(patch(query), rootValue);

  expect(asyncResult).toEqual(patch(syncResult));
  return syncResult;
}

// tslint:disable-next-line
describe("Execute: handles non-nullable types", () => {
  describe("nulls a nullable field", () => {
    const query = `
      {
        sync
      }
    `;

    test("that returns null", async () => {
      const result = await executeSyncAndAsync(query, nullingData);
      expect(result).toEqual({
        data: { sync: null }
      });
    });

    test("that throws", async () => {
      const result = await executeSyncAndAsync(query, throwingData);
      expect(result).toEqual({
        data: { sync: null },
        errors: [
          {
            message: syncError.message,
            path: ["sync"],
            locations: [{ line: 3, column: 9 }]
          }
        ]
      });
    });
  });

  describe("nulls a synchronously returned object that contains a non-nullable field", () => {
    const query = `
      {
        syncNest {
          syncNonNull,
        }
      }
    `;

    test("that returns null", async () => {
      const result = await executeSyncAndAsync(query, nullingData);
      expect(result).toEqual({
        data: { syncNest: null },
        errors: [
          {
            message:
              "Cannot return null for non-nullable field DataType.syncNonNull.",
            path: ["syncNest", "syncNonNull"],
            locations: [{ line: 4, column: 11 }]
          }
        ]
      });
    });

    test("that throws", async () => {
      const result = await executeSyncAndAsync(query, throwingData);
      expect(result).toEqual({
        data: { syncNest: null },
        errors: [
          {
            message: syncNonNullError.message,
            path: ["syncNest", "syncNonNull"],
            locations: [{ line: 4, column: 11 }]
          }
        ]
      });
    });
  });

  describe("nulls an object returned in a promise that contains a non-nullable field", () => {
    const query = `
      {
        promiseNest {
          syncNonNull,
        }
      }
    `;

    test("that returns null", async () => {
      const result = await executeSyncAndAsync(query, nullingData);
      expect(result).toEqual({
        data: { promiseNest: null },
        errors: [
          {
            message:
              "Cannot return null for non-nullable field DataType.syncNonNull.",
            path: ["promiseNest", "syncNonNull"],
            locations: [{ line: 4, column: 11 }]
          }
        ]
      });
    });

    test("that throws", async () => {
      const result = await executeSyncAndAsync(query, throwingData);
      expect(result).toEqual({
        data: { promiseNest: null },
        errors: [
          {
            message: syncNonNullError.message,
            path: ["promiseNest", "syncNonNull"],
            locations: [{ line: 4, column: 11 }]
          }
        ]
      });
    });
  });

  describe("nulls a complex tree of nullable fields, each", () => {
    const query = `
      {
        syncNest {
          sync
          promise
          syncNest { sync promise }
          promiseNest { sync promise }
        }
        promiseNest {
          sync
          promise
          syncNest { sync promise }
          promiseNest { sync promise }
        }
      }
    `;
    const data = {
      syncNest: {
        sync: null,
        promise: null,
        syncNest: { sync: null, promise: null },
        promiseNest: { sync: null, promise: null }
      },
      promiseNest: {
        sync: null,
        promise: null,
        syncNest: { sync: null, promise: null },
        promiseNest: { sync: null, promise: null }
      }
    };

    test("that returns null", async () => {
      const result = await executeQuery(query, nullingData);
      expect(result).toEqual({ data });
    });

    test("that throws", async () => {
      const result = await executeQuery(query, throwingData);
      expect(result).toEqual({
        data,
        errors: [
          {
            message: syncError.message,
            path: ["syncNest", "sync"],
            locations: [{ line: 4, column: 11 }]
          },
          {
            message: syncError.message,
            path: ["syncNest", "syncNest", "sync"],
            locations: [{ line: 6, column: 22 }]
          },
          {
            message: promiseError.message,
            path: ["syncNest", "promise"],
            locations: [{ line: 5, column: 11 }]
          },
          {
            message: promiseError.message,
            path: ["syncNest", "syncNest", "promise"],
            locations: [{ line: 6, column: 27 }]
          },
          {
            message: syncError.message,
            path: ["syncNest", "promiseNest", "sync"],
            locations: [{ line: 7, column: 25 }]
          },
          {
            message: syncError.message,
            path: ["promiseNest", "sync"],
            locations: [{ line: 10, column: 11 }]
          },
          {
            message: syncError.message,
            path: ["promiseNest", "syncNest", "sync"],
            locations: [{ line: 12, column: 22 }]
          },
          {
            message: promiseError.message,
            path: ["syncNest", "promiseNest", "promise"],
            locations: [{ line: 7, column: 30 }]
          },
          {
            message: promiseError.message,
            path: ["promiseNest", "promise"],
            locations: [{ line: 11, column: 11 }]
          },
          {
            message: promiseError.message,
            path: ["promiseNest", "syncNest", "promise"],
            locations: [{ line: 12, column: 27 }]
          },
          {
            message: syncError.message,
            path: ["promiseNest", "promiseNest", "sync"],
            locations: [{ line: 13, column: 25 }]
          },
          {
            message: promiseError.message,
            path: ["promiseNest", "promiseNest", "promise"],
            locations: [{ line: 13, column: 30 }]
          }
        ]
      });
    });
  });

  describe("nulls the first nullable object after a field in a long chain of non-null fields", () => {
    const query = `
      {
        syncNest {
          syncNonNullNest {
            promiseNonNullNest {
              syncNonNullNest {
                promiseNonNullNest {
                  syncNonNull
                }
              }
            }
          }
        }
        promiseNest {
          syncNonNullNest {
            promiseNonNullNest {
              syncNonNullNest {
                promiseNonNullNest {
                  syncNonNull
                }
              }
            }
          }
        }
        anotherNest: syncNest {
          syncNonNullNest {
            promiseNonNullNest {
              syncNonNullNest {
                promiseNonNullNest {
                  promiseNonNull
                }
              }
            }
          }
        }
        anotherPromiseNest: promiseNest {
          syncNonNullNest {
            promiseNonNullNest {
              syncNonNullNest {
                promiseNonNullNest {
                  promiseNonNull
                }
              }
            }
          }
        }
      }
    `;
    const data = {
      syncNest: null,
      promiseNest: null,
      anotherNest: null,
      anotherPromiseNest: null
    };

    test("that returns null", async () => {
      const result = await executeQuery(query, nullingData);
      expect(result).toEqual({
        data,
        errors: [
          {
            message:
              "Cannot return null for non-nullable field DataType.syncNonNull.",
            path: [
              "syncNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNull"
            ],
            locations: [{ line: 8, column: 19 }]
          },
          {
            message:
              "Cannot return null for non-nullable field DataType.syncNonNull.",
            path: [
              "promiseNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNull"
            ],
            locations: [{ line: 19, column: 19 }]
          },
          {
            message:
              "Cannot return null for non-nullable field DataType.promiseNonNull.",
            path: [
              "anotherNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "promiseNonNull"
            ],
            locations: [{ line: 30, column: 19 }]
          },
          {
            message:
              "Cannot return null for non-nullable field DataType.promiseNonNull.",
            path: [
              "anotherPromiseNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "promiseNonNull"
            ],
            locations: [{ line: 41, column: 19 }]
          }
        ]
      });
    });

    test("that throws", async () => {
      const result = await executeQuery(query, throwingData);
      expect(result).toEqual({
        data,
        errors: [
          {
            message: syncNonNullError.message,
            path: [
              "syncNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNull"
            ],
            locations: [{ line: 8, column: 19 }]
          },
          {
            message: syncNonNullError.message,
            path: [
              "promiseNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNull"
            ],
            locations: [{ line: 19, column: 19 }]
          },
          {
            message: promiseNonNullError.message,
            path: [
              "anotherNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "promiseNonNull"
            ],
            locations: [{ line: 30, column: 19 }]
          },
          {
            message: promiseNonNullError.message,
            path: [
              "anotherPromiseNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "syncNonNullNest",
              "promiseNonNullNest",
              "promiseNonNull"
            ],
            locations: [{ line: 41, column: 19 }]
          }
        ]
      });
    });
  });

  describe("nulls the top level if non-nullable field", () => {
    const query = `
      {
        syncNonNull
      }
    `;

    test("that returns null", async () => {
      const result = await executeSyncAndAsync(query, nullingData);
      expect(result).toEqual({
        data: null,
        errors: [
          {
            message:
              "Cannot return null for non-nullable field DataType.syncNonNull.",
            path: ["syncNonNull"],
            locations: [{ line: 3, column: 9 }]
          }
        ]
      });
    });

    test("that throws", async () => {
      const result = await executeSyncAndAsync(query, throwingData);
      expect(result).toEqual({
        data: null,
        errors: [
          {
            message: syncNonNullError.message,
            path: ["syncNonNull"],
            locations: [{ line: 3, column: 9 }]
          }
        ]
      });
    });
  });

  describe("Handles non-null argument", () => {
    const schemaWithNonNullArg = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          withNonNullArg: {
            type: GraphQLString,
            args: {
              cannotBeNull: {
                type: new GraphQLNonNull(GraphQLString)
              }
            },
            resolve: (_, args) => {
              if (typeof args.cannotBeNull === "string") {
                return "Passed: " + args.cannotBeNull;
              }
              return;
            }
          }
        }
      })
    });

    test("succeeds when passed non-null literal value", async () => {
      const result = await executeArgs({
        schema: schemaWithNonNullArg,
        document: parse(`
          query {
            withNonNullArg (cannotBeNull: "literal value")
          }
        `)
      });

      expect(result).toEqual({
        data: {
          withNonNullArg: "Passed: literal value"
        }
      });
    });

    test("succeeds when passed non-null variable value", async () => {
      const result = await executeArgs({
        schema: schemaWithNonNullArg,
        document: parse(`
          query ($testVar: String!) {
            withNonNullArg (cannotBeNull: $testVar)
          }
        `),
        variableValues: {
          testVar: "variable value"
        }
      });

      expect(result).toEqual({
        data: {
          withNonNullArg: "Passed: variable value"
        }
      });
    });

    test("succeeds when missing variable has default value", async () => {
      const result = await executeArgs({
        schema: schemaWithNonNullArg,
        document: parse(`
          query ($testVar: String = "default value") {
            withNonNullArg (cannotBeNull: $testVar)
          }
        `),
        variableValues: {
          // Intentionally missing variable
        }
      });

      expect(result).toEqual({
        data: {
          withNonNullArg: "Passed: default value"
        }
      });
    });

    test("field error when missing non-null arg", async () => {
      // Note: validation should identify this issue first (missing args rule)
      // however execution should still protect against this.
      const result = await executeArgs({
        schema: schemaWithNonNullArg,
        document: parse(`
          query {
            withNonNullArg
          }
        `)
      });

      expect(result).toEqual({
        errors: [
          {
            locations: [{ column: 13, line: 3 }],
            path: undefined,
            message:
              'Argument "cannotBeNull" of required type "String!" was not provided.'
          }
        ]
      });
    });

    test("field error when non-null arg provided null", async () => {
      // Note: validation should identify this issue first (values of correct
      // type rule) however execution should still protect against this.
      const result = await executeArgs({
        schema: schemaWithNonNullArg,
        document: parse(`
          query {
            withNonNullArg(cannotBeNull: null)
          }
        `)
      });
      expect(result).toEqual({
        errors: [
          {
            locations: [{ column: 42, line: 3 }],
            path: undefined,
            message:
              'Argument "cannotBeNull" of type "String!" has invalid value null.'
          }
        ]
      });
    });

    test("field error when non-null arg not provided variable value", async () => {
      // Note: validation should identify this issue first (variables in allowed
      // position rule) however execution should still protect against this.
      const result = await executeArgs({
        schema: schemaWithNonNullArg,
        document: parse(`
          query ($testVar: String) {
            withNonNullArg(cannotBeNull: $testVar)
          }
        `),
        variableValues: {
          // Intentionally missing variable
        }
      });

      expect(result).toEqual({
        data: {
          withNonNullArg: null
        },
        errors: [
          {
            message:
              'Argument "cannotBeNull" of required type "String!" was provided the variable ' +
              '"$testVar" which was not provided a runtime value.',
            locations: [{ line: 3, column: 42 }],
            path: ["withNonNullArg"]
          }
        ]
      });
    });

    test("field error when non-null arg provided variable with explicit null value", async () => {
      const result = await executeArgs({
        schema: schemaWithNonNullArg,
        document: parse(`
          query ($testVar: String = "default value") {
            withNonNullArg (cannotBeNull: $testVar)
          }
        `),
        variableValues: {
          testVar: null
        }
      });

      expect(result).toEqual({
        data: {
          withNonNullArg: null
        },
        errors: [
          {
            message:
              'Argument "cannotBeNull" of non-null type "String!" must not be null.',
            locations: [{ line: 3, column: 43 }],
            path: ["withNonNullArg"]
          }
        ]
      });
    });
  });
});
