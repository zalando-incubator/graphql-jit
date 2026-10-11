/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/mutations-test.js
 */

import {
  DocumentNode,
  execute,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { compileQuery, isCompiledQuery } from "../index";

class NumberHolder {
  theNumber: number;

  constructor(originalNumber: number) {
    this.theNumber = originalNumber;
  }
}

class Root {
  numberHolder: NumberHolder;

  constructor(originalNumber: number) {
    this.numberHolder = new NumberHolder(originalNumber);
  }

  immediatelyChangeTheNumber(newNumber: number): NumberHolder {
    this.numberHolder.theNumber = newNumber;
    return this.numberHolder;
  }

  promiseToChangeTheNumber(newNumber: number): Promise<NumberHolder> {
    return new Promise((resolve) => {
      process.nextTick(() => {
        resolve(this.immediatelyChangeTheNumber(newNumber));
      });
    });
  }

  failToChangeTheNumber(): NumberHolder {
    throw new Error("Cannot change the number");
  }

  promiseAndFailToChangeTheNumber(): Promise<NumberHolder> {
    return new Promise((_, reject) => {
      process.nextTick(() => {
        reject(new Error("Cannot change the number"));
      });
    });
  }
}

const numberHolderType = new GraphQLObjectType({
  fields: {
    theNumber: { type: GraphQLInt }
  },
  name: "NumberHolder"
});
const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    fields: {
      numberHolder: { type: numberHolderType }
    },
    name: "Query"
  }),
  mutation: new GraphQLObjectType({
    fields: {
      immediatelyChangeTheNumber: {
        type: numberHolderType,
        args: { newNumber: { type: GraphQLInt } },
        resolve(obj, { newNumber }) {
          return obj.immediatelyChangeTheNumber(newNumber);
        }
      },
      promiseToChangeTheNumber: {
        type: numberHolderType,
        args: { newNumber: { type: GraphQLInt } },
        resolve(obj, { newNumber }) {
          return obj.promiseToChangeTheNumber(newNumber);
        }
      },
      failToChangeTheNumber: {
        type: numberHolderType,
        args: { newNumber: { type: GraphQLInt } },
        resolve(obj, { newNumber }) {
          return obj.failToChangeTheNumber(newNumber);
        }
      },
      promiseAndFailToChangeTheNumber: {
        type: numberHolderType,
        args: { newNumber: { type: GraphQLInt } },
        resolve(obj, { newNumber }) {
          return obj.promiseAndFailToChangeTheNumber(newNumber);
        }
      }
    },
    name: "Mutation"
  })
});

function executeQuery(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue: any
) {
  const compiled = compileQuery(schema, document, "");
  if (!isCompiledQuery(compiled)) {
    throw compiled;
  }
  return compiled.query(rootValue, undefined, {});
}

describe("Execute: Handles mutation execution ordering with fragments", () => {
  test("evaluates mutations in document order", async () => {
    const executionOrder: string[] = [];

    const execSchema = makeExecutableSchema({
      typeDefs: `
        type NumberHolder { theNumber: Int }
        type Query { numberHolder: NumberHolder }
        type Mutation {
          unassign: NumberHolder
          createAssignments: NumberHolder
        }
      `,
      resolvers: {
        Mutation: {
          unassign(root: Root) {
            executionOrder.push("unassign");
            return root.immediatelyChangeTheNumber(1);
          },
          createAssignments(root: Root) {
            executionOrder.push("createAssignments");
            return root.immediatelyChangeTheNumber(2);
          }
        }
      }
    });

    const doc = parse(`
      mutation CreateAssignmentsForm($enableUnassign: Boolean!) {
        ...UnassignMutation
        createAssignments {
          theNumber
        }
      }

      fragment UnassignMutation on Mutation {
        unassign @include(if: $enableUnassign) {
          theNumber
        }
      }
    `);

    const compiled = compileQuery(execSchema, doc, "CreateAssignmentsForm");
    if (!isCompiledQuery(compiled)) {
      throw compiled;
    }

    executionOrder.length = 0;
    await compiled.query(new Root(0), undefined, { enableUnassign: true });
    expect(executionOrder).toEqual(["unassign", "createAssignments"]);

    executionOrder.length = 0;
    await compiled.query(new Root(0), undefined, { enableUnassign: false });
    expect(executionOrder).toEqual(["createAssignments"]);
  });
});

describe("Execute: Handles mutation execution ordering", () => {
  test("evaluates mutations serially", async () => {
    const doc = `mutation M {
      first: immediatelyChangeTheNumber(newNumber: 1) {
        theNumber
      },
      second: promiseToChangeTheNumber(newNumber: 2) {
        theNumber
      },
      third: immediatelyChangeTheNumber(newNumber: 3) {
        theNumber
      }
      fourth: promiseToChangeTheNumber(newNumber: 4) {
        theNumber
      },
      fifth: immediatelyChangeTheNumber(newNumber: 5) {
        theNumber
      }
    }`;

    const mutationResult = await executeQuery(schema, parse(doc), new Root(6));

    expect(mutationResult).toEqual({
      data: {
        first: { theNumber: 1 },
        second: { theNumber: 2 },
        third: { theNumber: 3 },
        fourth: { theNumber: 4 },
        fifth: { theNumber: 5 }
      }
    });
  });

  test("evaluates mutations correctly in the presence of a failed mutation", async () => {
    const doc = `mutation M {
      first: immediatelyChangeTheNumber(newNumber: 1) {
        theNumber
      },
      second: promiseToChangeTheNumber(newNumber: 2) {
        theNumber
      },
      third: failToChangeTheNumber(newNumber: 3) {
        theNumber
      }
      fourth: promiseToChangeTheNumber(newNumber: 4) {
        theNumber
      },
      fifth: immediatelyChangeTheNumber(newNumber: 5) {
        theNumber
      }
      sixth: promiseAndFailToChangeTheNumber(newNumber: 6) {
        theNumber
      }
    }`;

    const result = await executeQuery(schema, parse(doc), new Root(6));

    expect(result).toMatchObject({
      data: {
        first: { theNumber: 1 },
        second: { theNumber: 2 },
        third: null,
        fourth: { theNumber: 4 },
        fifth: { theNumber: 5 },
        sixth: null
      },
      errors: [
        {
          message: "Cannot change the number",
          locations: [{ line: 8, column: 7 }],
          path: ["third"]
        },
        {
          message: "Cannot change the number",
          locations: [{ line: 17, column: 7 }],
          path: ["sixth"]
        }
      ]
    });
  });
});

describe("Execute: serial execution with invalid arguments", () => {
  function createSchema(calls: string[], nonNullBad: boolean) {
    return new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: { noop: { type: GraphQLString } }
      }),
      mutation: new GraphQLObjectType({
        name: "Mutation",
        fields: {
          slow: {
            type: GraphQLString,
            resolve: async () => {
              calls.push("slow");
              return "slow";
            }
          },
          bad: {
            type: nonNullBad
              ? new GraphQLNonNull(GraphQLString)
              : GraphQLString,
            args: { value: { type: new GraphQLNonNull(GraphQLString) } },
            resolve: () => {
              calls.push("bad");
              return "bad";
            }
          },
          after: {
            type: GraphQLString,
            resolve: () => {
              calls.push("after");
              return "after";
            }
          }
        }
      })
    });
  }

  // Races against a timeout so a stalled queue fails instead of hanging.
  async function run(schema: GraphQLSchema, query: string) {
    const prepared: any = compileQuery(schema, parse(query));
    expect(prepared).not.toHaveProperty("errors");
    return Promise.race([
      Promise.resolve(prepared.query()),
      new Promise((resolve) => setTimeout(() => resolve("stalled"), 500))
    ]);
  }

  async function reference(schema: GraphQLSchema, query: string) {
    return execute({ schema, document: parse(query) });
  }

  // The error wording differs between the two executors.
  function shape(result: any) {
    return {
      data: result.data,
      errors: result.errors?.map((e: any) => ({
        path: e.path,
        locations: e.locations
      }))
    };
  }

  test.each([
    [
      "without a preceding field",
      "mutation ($v: String) { bad(value: $v) after }"
    ],
    [
      "after an async field",
      "mutation ($v: String) { slow bad(value: $v) after }"
    ]
  ])("a nullable field continues the queue %s", async (_name, query) => {
    const calls: string[] = [];
    const result: any = await run(createSchema(calls, false), query);
    const expectedCalls: string[] = [];
    const expected = await reference(createSchema(expectedCalls, false), query);

    expect(shape(result)).toEqual(shape(expected));
    expect(result.data.after).toBe("after");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toEqual(["bad"]);
    expect(calls).toEqual(expectedCalls);
    expect(calls).not.toContain("bad");
  });

  test.each([
    [
      "without a preceding field",
      "mutation ($v: String) { bad(value: $v) after }"
    ],
    [
      "after an async field",
      "mutation ($v: String) { slow bad(value: $v) after }"
    ]
  ])(
    "a non-null field completes without running later fields %s",
    async (_name, query) => {
      const calls: string[] = [];
      const result: any = await run(createSchema(calls, true), query);
      const expectedCalls: string[] = [];
      const expected = await reference(
        createSchema(expectedCalls, true),
        query
      );

      expect(shape(result)).toEqual(shape(expected));
      expect(result.data).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(calls).toEqual(expectedCalls);
      expect(calls).not.toContain("after");
    }
  );
});

describe("Execute: serial execution after non-null field errors", () => {
  function createSchema(calls: string[]) {
    const failing = (mode: string, name: string) => {
      calls.push(name);
      switch (mode) {
        case "throw":
          throw new Error("failed");
        case "reject":
          return Promise.reject(new Error("failed"));
        case "null":
          return null;
        default:
          return "ok";
      }
    };
    const Wrapper = new GraphQLObjectType({
      name: "Wrapper",
      fields: {
        inner: {
          type: new GraphQLNonNull(GraphQLString),
          args: { mode: { type: GraphQLString } },
          resolve: (_source, { mode }) => failing(mode, "inner")
        }
      }
    });
    return new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: { noop: { type: GraphQLString } }
      }),
      mutation: new GraphQLObjectType({
        name: "Mutation",
        fields: {
          slow: {
            type: GraphQLString,
            resolve: async () => {
              calls.push("slow");
              return "slow";
            }
          },
          strict: {
            type: new GraphQLNonNull(GraphQLString),
            args: { mode: { type: GraphQLString } },
            resolve: (_source, { mode }) => failing(mode, "strict")
          },
          lenient: {
            type: Wrapper,
            resolve: () => ({})
          },
          required: {
            type: new GraphQLNonNull(Wrapper),
            resolve: () => ({})
          },
          after: {
            type: GraphQLString,
            resolve: () => {
              calls.push("after");
              return "after";
            }
          }
        }
      })
    });
  }

  async function run(query: string) {
    const calls: string[] = [];
    const prepared: any = compileQuery(createSchema(calls), parse(query));
    expect(prepared).not.toHaveProperty("errors");
    // a stalled queue fails instead of hanging
    const result: any = await Promise.race([
      Promise.resolve(prepared.query()),
      new Promise((resolve) => setTimeout(() => resolve("stalled"), 500))
    ]);
    return { result, calls };
  }

  async function reference(query: string) {
    const calls: string[] = [];
    const result = await execute({
      schema: createSchema(calls),
      document: parse(query)
    });
    return { result, calls };
  }

  // The error wording differs between the two executors.
  function shape({ result, calls }: { result: any; calls: string[] }) {
    return {
      data: result.data,
      errors: result.errors?.map((e: any) => ({
        path: e.path,
        locations: e.locations
      })),
      calls
    };
  }

  test.each([
    [
      "a resolver that throws",
      'mutation { strict(mode: "throw") after }',
      true
    ],
    [
      "a resolver that rejects",
      'mutation { strict(mode: "reject") after }',
      true
    ],
    [
      "a resolver that rejects after an async field",
      'mutation { slow strict(mode: "reject") after }',
      true
    ],
    ["a null result", 'mutation { strict(mode: "null") after }', true],
    [
      "an error that propagates through non-null parents",
      'mutation { required { inner(mode: "throw") } after }',
      true
    ],
    [
      "an error absorbed by a nullable parent",
      'mutation { lenient { inner(mode: "throw") } after }',
      false
    ],
    ["a field that succeeds", 'mutation { strict(mode: "ok") after }', false]
  ])("%s", async (_name, query, stops) => {
    const expected = await reference(query);
    const actual = await run(query);

    expect(shape(actual)).toEqual(shape(expected));
    expect(actual.calls.includes("after")).toBe(!stops);
    expect(actual.result.data === null).toBe(stops);
  });
});
