/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/resolve-test.js
 */

import {
  GraphQLInt,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { GraphQLFieldConfig } from "graphql/type/definition";
import { compileQuery } from "../index";

function executeQuery(
  schema: GraphQLSchema,
  document: string,
  rootValue?: any,
  contextValue?: any,
  variableValues?: any,
  operationName?: string
) {
  const { query }: any = compileQuery(
    schema,
    parse(document),
    operationName || ""
  );
  return query(rootValue, contextValue, variableValues || {});
}

describe("Execute: resolve function", () => {
  function testSchema(testField: GraphQLFieldConfig<any, any>) {
    return new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          test: testField
        }
      })
    });
  }

  test("default function accesses properties", async () => {
    const schema = testSchema({ type: GraphQLString });

    const source = {
      test: "testValue"
    };

    expect(await executeQuery(schema, "{ test }", source)).toEqual({
      data: {
        test: "testValue"
      }
    });
  });

  test("default function passes args and context", async () => {
    const schema = testSchema({
      type: GraphQLInt,
      args: {
        addend1: { type: GraphQLInt }
      },
      resolve: (root: any, arg: any, c: any) => root.test(arg, c)
    });

    class Adder {
      constructor(private num: number) {}

      test({ addend1 }: any, context: any) {
        return this.num + addend1 + context.addend2;
      }
    }

    const source = new Adder(700);

    expect(
      await executeQuery(schema, "{ test(addend1: 80) }", source, {
        addend2: 9
      })
    ).toEqual({
      data: {
        test: 789
      }
    });
  });

  test("uses provided resolve function", async () => {
    const schema = testSchema({
      type: GraphQLString,
      args: {
        aStr: { type: GraphQLString },
        aInt: { type: GraphQLInt }
      },
      resolve(source, args) {
        return JSON.stringify([source, args]);
      }
    });

    expect(await executeQuery(schema, "{ test }")).toEqual({
      data: {
        test: "[null,{}]"
      }
    });

    expect(await executeQuery(schema, "{ test }", "Source!")).toEqual({
      data: {
        test: '["Source!",{}]'
      }
    });

    expect(
      await executeQuery(schema, '{ test(aStr: "String!") }', "Source!")
    ).toEqual({
      data: {
        test: '["Source!",{"aStr":"String!"}]'
      }
    });

    expect(
      await executeQuery(
        schema,
        '{ test(aInt: -123, aStr: "String!") }',
        "Source!"
      )
    ).toEqual({
      data: {
        test: '["Source!",{"aStr":"String!","aInt":-123}]'
      }
    });
  });
});

describe("Resolver: collision", () => {
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: {
        test: { type: GraphQLString, resolve: () => "test" },
        otherTest: {
          type: new GraphQLObjectType({
            name: "OtherTest",
            fields: {
              test: { type: GraphQLString, resolve: () => "otherTest" }
            }
          }),
          resolve: () => ({})
        }
      }
    })
  });

  test("has no collisions between resolver functions", async () => {
    expect(await executeQuery(schema, "{ test, otherTest { test } }")).toEqual({
      data: {
        test: "test",
        otherTest: {
          test: "otherTest"
        }
      }
    });
  });
});
