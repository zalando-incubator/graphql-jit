/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/sync-test.js
 */

import {
  DocumentNode,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { compileQuery, isPromise } from "../execution";

function graphqlSync(args: {
  schema: GraphQLSchema;
  rootValue?: any;
  source: string;
}) {
  const result = executeQuery({
    schema: args.schema,
    document: parse(args.source),
    rootValue: args.rootValue
  });

  // Assert that the execution was synchronous.
  if (isPromise(result)) {
    throw new Error("GraphQL execution failed to complete synchronously.");
  }
  return result;
}
function executeQuery(args: {
  schema: GraphQLSchema;
  rootValue?: any;
  document: DocumentNode;
}) {
  const prepared: any = compileQuery(args.schema, args.document, "");
  if (prepared.errors) {
    return prepared;
  }
  return prepared.query(args.rootValue, {}, undefined);
}

describe("Execute: synchronously when possible", () => {
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: {
        syncField: {
          type: GraphQLString,
          resolve(rootValue) {
            return rootValue;
          }
        },
        asyncField: {
          type: GraphQLString,
          async resolve(rootValue) {
            return await rootValue;
          }
        }
      }
    }),
    mutation: new GraphQLObjectType({
      name: "Mutation",
      fields: {
        syncMutationField: {
          type: GraphQLString,
          resolve(rootValue) {
            return rootValue;
          }
        }
      }
    })
  });

  test("does not return a Promise for initial errors", () => {
    const doc = "fragment Example on Query { syncField }";
    try {
      executeQuery({
        schema,
        document: parse(doc),
        rootValue: "rootValue"
      });
    } catch (e) {
      expect(e).toEqual({
        errors: [{ message: "Must provide an operation." }]
      });
    }
  });

  test("does not return a Promise if fields are all synchronous", () => {
    const doc = "query Example { syncField }";
    const result = executeQuery({
      schema,
      document: parse(doc),
      rootValue: "rootValue"
    });
    expect(result).toEqual({ data: { syncField: "rootValue" } });
  });

  test("does not return a Promise if mutation fields are all synchronous", () => {
    const doc = "mutation Example { syncMutationField }";
    const result = executeQuery({
      schema,
      document: parse(doc),
      rootValue: "rootValue"
    });
    expect(result).toEqual({ data: { syncMutationField: "rootValue" } });
  });

  test("returns a Promise if any field is asynchronous", async () => {
    const doc = "query Example { syncField, asyncField }";
    const result = executeQuery({
      schema,
      document: parse(doc),
      rootValue: "rootValue"
    });
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual({
      data: { syncField: "rootValue", asyncField: "rootValue" }
    });
  });

  describe("graphqlSync", () => {
    test("does not return a Promise for sync execution", () => {
      const doc = "query Example { syncField }";
      const result = graphqlSync({
        schema,
        source: doc,
        rootValue: "rootValue"
      });
      expect(result).toEqual({ data: { syncField: "rootValue" } });
    });

    test("throws if encountering async execution", () => {
      const doc = "query Example { syncField, asyncField }";
      expect(() => {
        graphqlSync({
          schema,
          source: doc,
          rootValue: "rootValue"
        });
      }).toThrow("GraphQL execution failed to complete synchronously.");
    });
  });
});
