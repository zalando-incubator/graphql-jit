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

async function executeTestQuery(
  query: string,
  disablingCapturingStackErrors: boolean,
  root: any = {}
) {
  const ast = parse(query);
  const compiled: any = await compileQuery(schema, ast, "", {
    disablingCapturingStackErrors
  });
  return compiled.query(root, undefined, {});
}

describe("error generation", () => {
  test("includes original error", async () => {
    const error = new Error("original");
    const resp = await executeTestQuery("{ b }", false, { b: error });
    expect(resp.errors[0].originalError).toBe(error);
  });
  test("is instanceOf upstream error", async () => {
    const resp = await executeTestQuery("{ b }", false, { b: new Error() });
    expect(resp.errors[0] instanceof GraphQLError).toBeTruthy();
    expect(resp.errors[0] instanceof Error).toBeTruthy();
  });
  describe("stack capture", () => {
    test("capture the stack", async () => {
      const error = "test";
      const resp = await executeTestQuery("{ b }", false, { b: error });
      expect(resp.errors[0].originalError).toBe(error);
      expect(resp.errors[0].stack).toBeDefined();
    });
    test("copies the stack if available", async () => {
      const resp = await executeTestQuery("{ b }", true, { b: new Error() });
      expect(resp.errors[0].stack).toBeDefined();
    });
    test("does not capture the stack if set in options", async () => {
      const error = "test";
      const resp = await executeTestQuery("{ b }", true, { b: error });
      expect(resp.errors[0].originalError).toBe(error);
      expect(resp.errors[0].stack).not.toBeDefined();
    });
    test("fallbacks if Error.captureStackTrace is not defined", async () => {
      const captureStackTrace = Error.captureStackTrace;
      Error.captureStackTrace = (null as unknown) as any;
      const resp = await executeTestQuery("{ b }", false, { b: "error" });
      expect(resp.errors[0].stack).toBeDefined();
      Error.captureStackTrace = captureStackTrace;
    });
  });
});
