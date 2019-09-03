/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/lists-test.js
 */

import {
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  GraphQLType,
  parse
} from "graphql";
import { compileQuery, isCompiledQuery } from "../index";

// resolved() is shorthand for Promise.resolve()
const resolved = Promise.resolve.bind(Promise);

// rejected() is shorthand for Promise.reject()
const rejected = Promise.reject.bind(Promise);

/**
 * This function creates a test case passed to "it", there's a time delay
 * between when the test is created and when the test is run, so if testData
 * contains a rejection, testData should be a function that returns that
 * rejection so as not to trigger the "unhandled rejection" error watcher.
 */
function check(testType: any, testData: any, expected: any) {
  return async () => {
    const data = { test: testData };

    const dataType: GraphQLObjectType = new GraphQLObjectType({
      name: "DataType",
      fields: () => ({
        test: { type: testType, resolve: (data: any) => data.test },
        nest: { type: dataType, resolve: () => data }
      })
    });
    const schema = new GraphQLSchema({ query: dataType });

    const ast = parse("{ nest { test } }");
    const prepared = compileQuery(schema, ast, "");
    if (!isCompiledQuery(prepared)) {
      throw prepared;
    }
    const response = await prepared.query(data, undefined, {});
    expect(response).toEqual(expected);
  };
}

describe("Execute: Accepts any iterable as list value", () => {
  test(
    "Accepts a Set as a List value",
    check(
      new GraphQLList(GraphQLString),
      new Set(["apple", "banana", "apple", "coconut"]),
      { data: { nest: { test: ["apple", "banana", "coconut"] } } }
    )
  );

  function* yieldItems() {
    yield "one";
    yield 2;
    yield true;
  }

  test(
    "Accepts an Generator function as a List value",
    check(new GraphQLList(GraphQLString), yieldItems(), {
      data: { nest: { test: ["one", "2", "true"] } }
    })
  );

  function getArgs(...args: any[]) {
    return args;
  }

  test(
    "Accepts function arguments as a List value",
    check(new GraphQLList(GraphQLString), getArgs("one", "two"), {
      data: { nest: { test: ["one", "two"] } }
    })
  );

  test(
    "Does not accept (Iterable) String-literal as a List value",
    check(new GraphQLList(GraphQLString), "Singular", {
      data: { nest: { test: null } },
      errors: [
        {
          message:
            "Expected Iterable, but did not find one for field DataType.test.",
          locations: [{ line: 1, column: 10 }],
          path: ["nest", "test"]
        }
      ]
    })
  );
  test(
    "Does not accept (Iterable) String-literal as a Non null List value",
    check(new GraphQLNonNull(new GraphQLList(GraphQLString)), "Singular", {
      data: { nest: null },
      errors: [
        {
          message:
            "Expected Iterable, but did not find one for field DataType.test.",
          locations: [{ line: 1, column: 10 }],
          path: ["nest", "test"]
        }
      ]
    })
  );
});

const containsValues = "Contains values";
const containsNull = "Contains null";

// tslint:disable-next-line
describe("Execute: Handles list nullability", () => {
  describe("[T]", () => {
    const type = new GraphQLList(GraphQLInt);

    describe("Array<T>", () => {
      test(
        containsValues,
        check(type, [1, 2], { data: { nest: { test: [1, 2] } } })
      );

      test(
        containsNull,
        check(type, [1, null, 2], { data: { nest: { test: [1, null, 2] } } })
      );

      test(
        "Returns null",
        check(type, null, { data: { nest: { test: null } } })
      );
    });

    describe("Promise<Array<T>>", () => {
      test(
        containsValues,
        check(type, resolved([1, 2]), { data: { nest: { test: [1, 2] } } })
      );

      test(
        containsNull,
        check(type, resolved([1, null, 2]), {
          data: { nest: { test: [1, null, 2] } }
        })
      );

      test(
        "Returns null",
        check(type, resolved(null), { data: { nest: { test: null } } })
      );

      test(
        "Rejected",
        check(type, rejected(new Error("bad")), {
          data: { nest: { test: null } },
          errors: [
            {
              message: "bad",
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test"]
            }
          ]
        })
      );
    });

    describe("Array<Promise<T>>", () => {
      test(
        containsValues,
        check(type, [resolved(1), resolved(2)], {
          data: { nest: { test: [1, 2] } }
        })
      );

      test(
        containsNull,
        check(type, [resolved(1), resolved(null), resolved(2)], {
          data: { nest: { test: [1, null, 2] } }
        })
      );

      test(
        "Contains reject",
        check(type, [resolved(1), rejected(new Error("bad")), resolved(2)], {
          data: { nest: { test: [1, null, 2] } },
          errors: [
            {
              message: "bad",
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );
    });
  });

  const errorStr = "Cannot return null for non-nullable field DataType.test.";

  describe("[T]!", () => {
    const type = new GraphQLNonNull(new GraphQLList(GraphQLInt));

    describe("Array<T>", () => {
      test(
        containsValues,
        check(type, [1, 2], { data: { nest: { test: [1, 2] } } })
      );

      test(
        containsNull,
        check(type, [1, null, 2], { data: { nest: { test: [1, null, 2] } } })
      );

      test(
        "Returns null",
        check(type, null, {
          data: { nest: null },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test"]
            }
          ]
        })
      );
    });

    describe("Promise<Array<T>>", () => {
      test(
        containsValues,
        check(type, resolved([1, 2]), { data: { nest: { test: [1, 2] } } })
      );

      test(
        containsNull,
        check(type, resolved([1, null, 2]), {
          data: { nest: { test: [1, null, 2] } }
        })
      );

      test(
        "Returns null",
        check(type, resolved(null), {
          data: { nest: null },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test"]
            }
          ]
        })
      );

      test(
        "Rejected",
        check(type, rejected(new Error("bad")), {
          data: { nest: null },
          errors: [
            {
              message: "bad",
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test"]
            }
          ]
        })
      );
    });

    // tslint:disable-next-line
    describe("Array<Promise<T>>", () => {
      test(
        containsValues,
        check(type, [resolved(1), resolved(2)], {
          data: { nest: { test: [1, 2] } }
        })
      );

      test(
        containsNull,
        check(type, [resolved(1), resolved(null), resolved(2)], {
          data: { nest: { test: [1, null, 2] } }
        })
      );

      test(
        "Contains reject",
        check(type, [resolved(1), rejected(new Error("bad")), resolved(2)], {
          data: { nest: { test: [1, null, 2] } },
          errors: [
            {
              message: "bad",
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );
    });
  });

  describe("[T!]", () => {
    const type = new GraphQLList(new GraphQLNonNull(GraphQLInt));

    describe("Array<T>", () => {
      test(
        containsValues,
        check(type, [1, 2], { data: { nest: { test: [1, 2] } } })
      );

      test(
        containsNull,
        check(type, [1, null, 2], {
          data: { nest: { test: null } },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );

      test(
        "Returns null",
        check(type, null, { data: { nest: { test: null } } })
      );
    });

    describe("Promise<Array<T>>", () => {
      test(
        containsValues,
        check(type, resolved([1, 2]), { data: { nest: { test: [1, 2] } } })
      );

      test(
        containsNull,
        check(type, resolved([1, null, 2]), {
          data: { nest: { test: null } },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );

      test(
        "Returns null",
        check(type, resolved(null), { data: { nest: { test: null } } })
      );

      test(
        "Rejected",
        check(type, rejected(new Error("bad")), {
          data: { nest: { test: null } },
          errors: [
            {
              message: "bad",
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test"]
            }
          ]
        })
      );
    });

    describe("Array<Promise<T>>", () => {
      test(
        containsValues,
        check(type, [resolved(1), resolved(2)], {
          data: { nest: { test: [1, 2] } }
        })
      );

      test(
        containsNull,
        check(type, [resolved(1), resolved(null), resolved(2)], {
          data: { nest: { test: null } },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );

      test(
        "Contains reject",
        check(type, [resolved(1), rejected(new Error("bad")), resolved(2)], {
          data: { nest: { test: null } },
          errors: [
            {
              message: "bad",
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );
    });
  });

  describe("[T!]!", () => {
    const type = new GraphQLNonNull(
      new GraphQLList(new GraphQLNonNull(GraphQLInt))
    );

    describe("Array<T>", () => {
      test(
        containsValues,
        check(type, [1, 2], { data: { nest: { test: [1, 2] } } })
      );

      test(
        containsNull,
        check(type, [1, null, 2], {
          data: { nest: null },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );

      test(
        "Returns null",
        check(type, null, {
          data: { nest: null },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test"]
            }
          ]
        })
      );
    });

    describe("Promise<Array<T>>", () => {
      test(
        containsValues,
        check(type, resolved([1, 2]), { data: { nest: { test: [1, 2] } } })
      );

      test(
        containsNull,
        check(type, resolved([1, null, 2]), {
          data: { nest: null },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );

      test(
        "Returns null",
        check(type, resolved(null), {
          data: { nest: null },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test"]
            }
          ]
        })
      );

      test(
        "Rejected",
        check(type, rejected(new Error("bad")), {
          data: { nest: null },
          errors: [
            {
              message: "bad",
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test"]
            }
          ]
        })
      );
    });

    describe("Array<Promise<T>>", () => {
      test(
        containsValues,
        check(type, [resolved(1), resolved(2)], {
          data: { nest: { test: [1, 2] } }
        })
      );

      test(
        containsNull,
        check(type, [resolved(1), resolved(null), resolved(2)], {
          data: { nest: null },
          errors: [
            {
              message: errorStr,
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );

      test(
        "Contains reject",
        check(type, [resolved(1), rejected(new Error("bad")), resolved(2)], {
          data: { nest: null },
          errors: [
            {
              message: "bad",
              locations: [{ line: 1, column: 10 }],
              path: ["nest", "test", 1]
            }
          ]
        })
      );
    });
  });
});

describe("Execute: Handles nested lists", () => {
  function check(
    testType: GraphQLType,
    query: string | undefined,
    testData: any,
    expected: any
  ) {
    return async () => {
      const dataType: GraphQLObjectType = new GraphQLObjectType({
        name: "DataType",
        fields: () => ({
          test: {
            type: new GraphQLList(new GraphQLList(testType)),
            resolve: (data: any) => data
          }
        })
      });
      const schema = new GraphQLSchema({ query: dataType });
      const ast = parse(query || "{ test }");
      const prepared = compileQuery(schema, ast, "");
      if (!isCompiledQuery(prepared)) {
        throw prepared;
      }
      const response = await prepared.query(testData, undefined, {});
      expect(response).toEqual(expected);
    };
  }

  test(
    "[[Scalar]]",
    check(GraphQLString, undefined, [["test"]], { data: { test: [["test"]] } })
  );
  test(
    "[Promise<[Promise<Scalar>]>]",
    check(
      GraphQLString,
      undefined,
      [Promise.resolve([Promise.resolve("test")])],
      {
        data: { test: [["test"]] }
      }
    )
  );
  test(
    "[[PromiseRejected<Scalar>]]",
    check(GraphQLString, undefined, [[Promise.reject("test")]], {
      data: { test: [[null]] },
      errors: [
        {
          locations: [{ column: 3, line: 1 }],
          message: "test",
          path: ["test", 0, 0]
        }
      ]
    })
  );
  test(
    "wrong type for serialization [[Promise<BadScalar>]]",
    check(GraphQLString, undefined, [[Promise.resolve({ test: "" })]], {
      data: { test: [[null]] },
      errors: [
        {
          locations: [{ column: 3, line: 1 }],
          message: 'String cannot represent value: { test: "" }',
          path: ["test", 0, 0]
        }
      ]
    })
  );
  test(
    "[[Object]]",
    check(
      new GraphQLObjectType({
        name: "Object",
        fields: () => ({
          obj: {
            type: GraphQLString
          }
        })
      }),
      "{test {obj}}",
      [[{ obj: "test" }]],
      { data: { test: [[{ obj: "test" }]] } }
    )
  );
  test(
    "[[Promise<Object>]]",
    check(
      new GraphQLObjectType({
        name: "Object",
        fields: () => ({
          obj: {
            type: GraphQLString
          }
        })
      }),
      "{test {obj}}",
      [[Promise.resolve({ obj: "test" })]],
      { data: { test: [[{ obj: "test" }]] } }
    )
  );
  test(
    "[[Promise<Object with nested resolver>]]",
    check(
      new GraphQLObjectType({
        name: "Object",
        fields: () => ({
          obj: {
            type: GraphQLString,
            resolve: ({ obj }) => obj
          }
        })
      }),
      "{test {obj}}",
      [[Promise.resolve({ obj: "test" })]],
      { data: { test: [[{ obj: "test" }]] } }
    )
  );
  test(
    "[[Promise<Object with Promise field>]]",
    check(
      new GraphQLObjectType({
        name: "Object",
        fields: () => ({
          obj: {
            type: GraphQLString,
            resolve: ({ obj }) => Promise.resolve(obj)
          }
        })
      }),
      "{test {obj}}",
      [[Promise.resolve({ obj: "test" })]],
      { data: { test: [[{ obj: "test" }]] } }
    )
  );
  test(
    "[[PromiseRejected<Object>]]",
    check(
      new GraphQLObjectType({
        name: "Object",
        fields: () => ({
          obj: {
            type: GraphQLString
          }
        })
      }),
      "{test {obj}}",
      [[{ obj: "test" }, Promise.reject("bad")]],
      {
        data: { test: [[{ obj: "test" }, null]] },
        errors: [
          {
            locations: [{ column: 2, line: 1 }],
            message: "bad",
            path: ["test", 0, 1]
          }
        ]
      }
    )
  );
  test(
    "[[PromiseRejected<Object>!]]",
    check(
      new GraphQLNonNull(
        new GraphQLObjectType({
          name: "Object",
          fields: () => ({
            obj: {
              type: GraphQLString
            }
          })
        })
      ),
      "{test {obj}}",
      [[{ obj: "test" }, Promise.reject("bad")]],
      {
        data: { test: [null] },
        errors: [
          {
            locations: [{ column: 2, line: 1 }],
            message: "bad",
            path: ["test", 0, 1]
          }
        ]
      }
    )
  );
});

describe("resolved fields in object list", () => {
  function getSchema(data: any) {
    const article: GraphQLObjectType = new GraphQLObjectType({
      name: "Article",
      fields: {
        id: { type: new GraphQLNonNull(GraphQLID), resolve: obj => obj.id }
      }
    });

    return new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          feed: {
            type: new GraphQLList(article),
            resolve: () => data
          }
        }
      })
    });
  }

  test("executes using a schema for a success array", async () => {
    const request = `
      {
        feed {
          id
        }
      }
    `;

    const prepared: any = compileQuery(
      getSchema([{ id: 123 }]),
      parse(request),
      ""
    );
    const response = await prepared.query(undefined, undefined, {});
    expect(response).toEqual({
      data: {
        feed: [{ id: "123" }]
      }
    });
  });
  test("executes with nulls", async () => {
    const request = `
      {
        feed {
          id
        }
      }
    `;

    const prepared: any = compileQuery(
      getSchema([{ id: 123 }, null]),
      parse(request),
      ""
    );
    const response = await prepared.query(undefined, undefined, {});
    expect(response).toEqual({
      data: {
        feed: [{ id: "123" }, null]
      }
    });
  });
  test("executes with errors", async () => {
    const request = `
      {
        feed {
          id
        }
      }
    `;

    const prepared: any = compileQuery(
      getSchema([{ id: 123 }, { id: new Error("test") }]),
      parse(request),
      ""
    );
    const response = await prepared.query(undefined, undefined, {});
    expect(response).toEqual({
      data: {
        feed: [{ id: "123" }, null]
      },
      errors: [
        {
          locations: [{ column: 11, line: 4 }],
          message: "test",
          path: ["feed", 1, "id"]
        }
      ]
    });
  });
  test("ignores undefined fields using a schema", async () => {
    const request = `
      {
        feed {
          id
          title
        }
      }
    `;

    // Note: this is intentionally not validating the query to ensure appropriate
    // behavior occurs when executing an invalid query.

    const prepared: any = compileQuery(getSchema([]), parse(request), "");
    expect(prepared.query(undefined, undefined, undefined)).toEqual({
      data: { feed: [] }
    });
  });
});
