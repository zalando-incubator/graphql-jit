import { GraphQLSchema, DocumentNode, parse } from "graphql";
import { compileQuery, isCompiledQuery } from "../execution";
import { makeExecutableSchema } from "graphql-tools";

describe("GraphQLJitResolveInfo", () => {
  describe("simple types", () => {
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

  describe("interfaces", () => {
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

    test("fields per type - with fragments", async () => {
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
                  ...bar1
                }
                ... on Bar2 {
                  b2
                }
                ...bar2
              }
            }
            fragment bar1 on Bar1 {
              id
              b1
            }
            fragment bar2 on Bar2 {
              title
              b2
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

  describe("unions", () => {
    let inf: any;
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          uBaz: Baz
        }
        union Baz = Foo | Bar
        type Foo {
          foo: String
        }
        type Bar {
          bar: Int
        }
      `,
      resolvers: {
        Query: {
          uBaz(_: any, _1: any, _2: any, info: any) {
            inf = info;
          }
        },
        Baz: {
          __resolveType() {
            return "Foo";
          }
        }
      }
    });

    afterEach(() => {
      inf = undefined;
    });

    test("union field nodes", async () => {
      await executeQuery(
        schema,
        parse(
          `
            query {
              uBaz {
                ... on Foo {
                  foo
                }
                ... on Bar {
                  bar
                }
              }
            }
          `
        )
      );

      expect(inf.fields).toMatchObject({
        Foo: expect.arrayContaining(["foo"]),
        Bar: expect.arrayContaining(["bar"])
      });

      // should not contain the union type as there cannot
      // be a selection set for unions without a specific type
      expect(Object.keys(inf.fields)).not.toContain("Baz");
    });

    test("unions with fragments", async () => {
      await executeQuery(
        schema,
        parse(
          `
            query {
              uBaz {
                ...foo
                ...bar
              }
            }
            fragment foo on Foo {
              foo
            }
            fragment bar on Bar {
              bar
            }
          `
        )
      );

      expect(inf.fields).toMatchObject({
        Foo: expect.arrayContaining(["foo"]),
        Bar: expect.arrayContaining(["bar"])
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
