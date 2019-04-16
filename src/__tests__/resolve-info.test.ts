import { GraphQLSchema, DocumentNode, parse } from "graphql";
import { GraphQLJitResolveInfo } from "../resolve-info";
import { compileQuery, isCompiledQuery } from "../execution";
import { makeExecutableSchema } from "graphql-tools";

describe("resolve-info", () => {
  describe("GraphQLJitResolveInfo - simple types", () => {
    let inf: any;
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          foo: Foo
        }
        type Foo {
          a: String
          b: Int
          c: Boolean!
        }
      `,
      resolvers: {
        Query: {
          foo(_: any, _1: any, _2: any, info: any) {
            inf = info;
          }
        }
      }
    });

    afterEach(() => {
      inf = undefined;
    });

    test("all selection fields of the current resolver", async () => {
      await executeQuery(schema, parse(`query { foo { a b c } }`));
      expect(inf.fields).toMatchObject({
        Foo: expect.arrayContaining(["a", "b", "c"])
      });
    });

    test("interface fields", async () => {
      await executeQuery(
        schema,
        parse(
          `
          query {
            foo {
              ...fooFragment1
              a
              b
              ... on Foo {
                c
                ...fooFragment1
              }
            }
          }
          fragment fooFragment1 on Foo {
            a
            b
          }
          `
        )
      );

      expect(inf.fields).toMatchObject({
        Foo: expect.arrayContaining(["a", "b", "c"])
      });
    });
  });

  describe("jit resolve info for interfaces", () => {
    let inf: any;
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          iBar: IBar
        }
        interface IBar {
          id: ID!
          title: String
        }
        type Bar1 implements IBar {
          id: ID!
          title: String
          b1: Int!
        }
        type Bar2 implements IBar {
          id: ID!
          title: String
          b2: Boolean!
        }
      `,
      resolvers: {
        Query: {
          iBar(_: any, _1: any, _2: any, info: any) {
            inf = info;
          }
        },
        IBar: {
          __resolveType() {
            return "Bar1";
          }
        }
      }
    });

    afterEach(() => {
      inf = undefined;
    });

    test("compute interface field nodes", async () => {
      await executeQuery(
        schema,
        parse(
          `
            query {
              iBar {
                id
                title
              }
            }
          `
        )
      );

      expect(inf.fields).toMatchObject({
        IBar: expect.arrayContaining(["id", "title"])
      });
    });

    test("fields per type", async () => {
      await executeQuery(
        schema,
        parse(
          `
            query {
              iBar {
                id
                title
                ... on Bar1 {
                  b1
                }
                ... on Bar2 {
                  b2
                }
              }
            }
          `
        )
      );

      expect(inf.fields).toMatchObject({
        IBar: expect.arrayContaining(["id", "title"]),
        Bar1: expect.arrayContaining(["id", "title", "b1"]),
        Bar2: expect.arrayContaining(["id", "title", "b2"])
      });
    });
  });
});

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

interface Resolver {
  (parent: any, params: any, context: any, info: GraphQLJitResolveInfo): any;
}
