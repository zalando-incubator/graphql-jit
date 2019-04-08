import {
  GraphQLError,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { compileQuery } from "../execution";

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
        resolve({ b }: { b: Error }) {
          throw b;
        }
      }
    }
  })
});

function executeTestQuery(
  query: string,
  disablingCapturingStackErrors: boolean,
  root: any = {}
) {
  const ast = parse(query);
  const compiled: any = compileQuery(schema, ast, "", {
    disablingCapturingStackErrors
  });
  return compiled.query(root, undefined, {});
}

describe("error generation", () => {
  test("includes original error", () => {
    const error = new Error("original");
    const resp = executeTestQuery("{ b }", false, { b: error });
    expect(resp.errors[0].originalError).toBe(error);
  });
  test("is instanceOf upstream error", () => {
    const resp = executeTestQuery("{ b }", false, { b: new Error() });
    expect(resp.errors[0] instanceof GraphQLError).toBeTruthy();
    expect(resp.errors[0] instanceof Error).toBeTruthy();
  });
  describe("stack capture", () => {
    test("capture the stack", () => {
      const error = "test";
      const resp = executeTestQuery("{ b }", false, { b: error });
      expect(resp.errors[0].originalError).toBe(error);
      expect(resp.errors[0].stack).toBeDefined();
    });
    test("copies the stack if available", () => {
      const resp = executeTestQuery("{ b }", true, { b: new Error() });
      expect(resp.errors[0].stack).toBeDefined();
    });
    test("does not capture the stack if set in options", () => {
      const error = "test";
      const resp = executeTestQuery("{ b }", true, { b: error });
      expect(resp.errors[0].originalError).toBe(error);
      expect(resp.errors[0].stack).not.toBeDefined();
    });
    test("fallbacks if Error.captureStackTrace is not defined", () => {
      const captureStackTrace = Error.captureStackTrace;
      Error.captureStackTrace = (null as unknown) as any;
      const resp = executeTestQuery("{ b }", false, { b: "error" });
      expect(resp.errors[0].stack).toBeDefined();
      Error.captureStackTrace = captureStackTrace;
    });
  });
});
