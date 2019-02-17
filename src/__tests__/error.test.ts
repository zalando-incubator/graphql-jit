import {
  GraphQLError,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { compileQuery } from "../execution";

const error = new Error("original");
const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "TestType",
    fields: {
      a: {
        type: GraphQLString,
        resolve() {
          return "a";
        }
      },
      b: {
        type: GraphQLString,
        resolve() {
          throw error;
        }
      }
    }
  })
});

function executeTestQuery(query: string) {
  const ast = parse(query);
  const compiled: any = compileQuery(schema, ast, "");
  return compiled.query({}, undefined, {});
}

describe("error generation", () => {
  test("includes original error", () => {
    const resp = executeTestQuery("{ b }");
    expect(resp.errors[0].originalError).toBe(error);
  });
  test("is instanceOf upstream error", () => {
    const resp = executeTestQuery("{ b }");
    expect(resp.errors[0] instanceof GraphQLError).toBeTruthy();
  });
});
