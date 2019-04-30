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
          "Foo": Object {
            "foo": true,
          },
        }
      `);

      // should not contain the union type as there cannot
      // be a selection set for unions without a specific type
      expect(Object.keys(inf.fieldExpansion)).not.toContain("Baz");
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
          "Foo": Object {
            "foo": true,
          },
        }
      `);
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
