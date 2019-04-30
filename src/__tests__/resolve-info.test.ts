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
          d: Bar
        }
        type Bar {
          e: String!
          f: Boolean!
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
      const result = await executeQuery(
        schema,
        parse(`query { foo { a d { e } } }`)
      );
      expect(result.errors).not.toBeDefined();

      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Foo": Object {
            "a": true,
            "d": Object {
              "Bar": Object {
                "e": true,
              },
            },
          },
        }
      `);
    });

    test("with fragments", async () => {
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

      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Foo": Object {
            "a": true,
            "b": true,
            "c": true,
          },
        }
      `);
    });

    test("inline fragments", async () => {
      await executeQuery(
        schema,
        parse(
          `
          query {
            foo {
              ... {
                ... {
                  d {
                    ... {
                      e
                    }
                  }
                }
              }
            }
          }
          `
        )
      );

      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Foo": Object {
            "d": Object {
              "Bar": Object {
                "e": true,
              },
            },
          },
        }
      `);
    });

    test("aggregate multiple selections of the same field", async () => {
      await executeQuery(
        schema,
        parse(
          `
          query {
            foo {
              a
            }
            foo {
              b
            }
            foo {
              c
            }
          }
          `
        )
      );

      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Foo": Object {
            "a": true,
            "b": true,
            "c": true,
          },
        }
      `);
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
      const result = await executeQuery(
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

      expect(result.errors).not.toBeDefined();

      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Bar1": Object {
            "id": true,
            "title": true,
          },
          "Bar2": Object {
            "id": true,
            "title": true,
          },
          "IBar": Object {
            "id": true,
            "title": true,
          },
        }
      `);
    });

    test("fields per type", async () => {
      const result = await executeQuery(
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
      expect(result.errors).not.toBeDefined();
      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Bar1": Object {
            "b1": true,
            "id": true,
            "title": true,
          },
          "Bar2": Object {
            "b2": true,
            "id": true,
            "title": true,
          },
          "IBar": Object {
            "id": true,
            "title": true,
          },
        }
      `);
    });

    test("fields per type - with fragments", async () => {
      const result = await executeQuery(
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

      expect(result.errors).not.toBeDefined();
      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Bar1": Object {
            "b1": true,
            "id": true,
            "title": true,
          },
          "Bar2": Object {
            "b2": true,
            "id": true,
            "title": true,
          },
          "IBar": Object {
            "id": true,
            "title": true,
          },
        }
      `);
    });

    test("aggregate multiple selections of the same field", async () => {
      const result = await executeQuery(
        schema,
        parse(
          `
            query {
              iBar {
                id
              }
              iBar {
                title
              }
              iBar {
                ... on Bar1 {
                  b1
                }
              }
              iBar {
                ... on Bar2 {
                  b2
                }
              }
            }
          `
        )
      );

      expect(result.errors).not.toBeDefined();

      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Bar1": Object {
            "b1": true,
            "id": true,
            "title": true,
          },
          "Bar2": Object {
            "b2": true,
            "id": true,
            "title": true,
          },
          "IBar": Object {
            "id": true,
            "title": true,
          },
        }
      `);
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
      const result = await executeQuery(
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

      expect(result.errors).not.toBeDefined();
      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Bar": Object {
            "bar": true,
          },
          "Baz": Object {},
          "Foo": Object {
            "foo": true,
          },
        }
      `);
    });

    test("__typename", async () => {
      const result = await executeQuery(
        schema,
        parse(`
          query {
            uBaz {
              __typename
              alias: __typename
            }
          }
        `)
      );
      expect(result.errors).not.toBeDefined();
      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Bar": Object {
            "__typename": true,
          },
          "Baz": Object {
            "__typename": true,
          },
          "Foo": Object {
            "__typename": true,
          },
        }
      `);
    });

    test("unions with fragments", async () => {
      const result = await executeQuery(
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

      expect(result.errors).not.toBeDefined();
      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Bar": Object {
            "bar": true,
          },
          "Baz": Object {},
          "Foo": Object {
            "foo": true,
          },
        }
      `);
    });

    test("aggregate multiple selections of the same field", async () => {
      const result = await executeQuery(
        schema,
        parse(
          `
            query {
              uBaz {
                ...bar
              }
              ... {
                uBaz {
                  ...foo
                }
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

      expect(result.errors).not.toBeDefined();
      expect(inf.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Bar": Object {
            "bar": true,
          },
          "Baz": Object {},
          "Foo": Object {
            "foo": true,
          },
        }
      `);
    });
  });

  describe("lists", () => {
    let infFoos: any;
    let infFooOrBars: any;
    let infMedia: any;
    let infFooBars: any;
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          foos: [Foo!]
          fooOrBars: [FooOrBar!]
          media: [Media!]!
        }
        type Foo {
          bars: [Bar]
        }
        type Bar {
          strs: [String!]
        }
        union FooOrBar = Foo | Bar
        interface Media {
          url: String
        }
        type Image implements Media {
          url: String
          width: Int
        }
        type Video implements Media {
          url: String
          kind: VideoKind
        }
        enum VideoKind {
          YOUTUBE
          VIMEO
        }
      `,
      resolverValidationOptions: { requireResolversForResolveType: false },
      resolvers: {
        Query: {
          foos(_: any, _1: any, _2: any, info: any) {
            infFoos = info;
          },
          fooOrBars(_: any, _1: any, _2: any, info: any) {
            infFooOrBars = info;
          },
          media(_: any, _1: any, _2: any, info: any) {
            infMedia = info;
          }
        },
        Foo: {
          bars(_: any, _1: any, _2: any, info: any) {
            infFooBars = info;
          }
        }
      }
    });

    afterEach(() => {
      infFoos = undefined;
      infFooOrBars = undefined;
      infMedia = undefined;
      infFooBars = undefined;
    });

    test("object", async () => {
      const result = await executeQuery(
        schema,
        parse(`
          query {
            foos {
              bars {
                strs
              }
            }
          }
        `)
      );
      expect(result.errors).not.toBeDefined();
      expect(infFoos.fieldExpansion).toMatchInlineSnapshot(`
        Object {
          "Foo": Object {
            "bars": Object {
              "Bar": Object {
                "strs": true,
              },
            },
          },
        }
      `);
    });

    // TODO
  });

  // user errors that happen during resolve info computation
  describe("errors", () => {
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          foo: Foo!
        }
        type Foo {
          baz: Int!
        }
      `,
      resolvers: {
        Query: {
          foo() {
            return {
              baz: 10
            };
          }
        }
      }
    });

    test("non-existant field in type", async () => {
      const result = await executeQuery(
        schema,
        parse(`query { foo { fieldDoesNotExist1 { id } } }`)
      );
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toContain("fieldDoesNotExist1");
    });

    test("invalid inline fragment - type does not exist", async () => {
      const result = await executeQuery(
        schema,
        parse(`query { foo { ... on NotFound { bar } } }`)
      );
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toContain("NotFound");
    });

    test("invalid fragment - type does not exist", async () => {
      const result = await executeQuery(
        schema,
        parse(`query { foo { ...frag } } fragment frag on NotFound2 { id }`)
      );
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toContain("NotFound2");
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
