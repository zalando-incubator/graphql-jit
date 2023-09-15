import { DocumentNode, GraphQLSchema, parse, validate } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { compileQuery, isCompiledQuery } from "../execution";

describe("recursive input types", () => {
  describe("simple recursive input", () => {
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          foo(input: FooInput): String
        }
        input FooInput {
          foo: FooInput
        }
      `,
      resolvers: {
        Query: {
          foo(_, args) {
            // used as the actual value in test matchers
            return JSON.stringify(args);
          }
        }
      }
    });

    test.only("should not fail for recursive input without variables", () => {
      const query = parse(`
        {
          foo(input: {
            foo: {
              foo: {
                foo: {
                  foo: {}
                }
              }
            }
          })
        }
      `);

      const result = executeQuery(schema, query);

      expect(result.errors).toBeUndefined();
      expect(result.data.foo).toBe(
        JSON.stringify({
          input: {
            foo: { foo: { foo: { foo: {} } } }
          }
        })
      );
    });

    test("should not fail with variables using recursive input types", () => {
      const document = parse(`
        query ($f: FooInput) {
          foo(input: $f)
        }
      `);
      const variables = {
        f: {
          foo: { foo: { foo: {} } }
        }
      };

      const result = executeQuery(schema, document, variables);
      expect(result.errors).toBeUndefined();
      expect(result.data.foo).toBe(
        JSON.stringify({
          input: { foo: { foo: { foo: {} } } }
        })
      );
    });

    // when the recursive variable appers at a nested level
    test("should not fail with variables using recursive input types - 2", () => {
      const document = parse(`
        query ($f: FooInput) {
          foo(input: {
            foo: { foo: { foo: $f } }
          })
        }
      `);
      const variables = {
        f: {
          foo: { foo: { foo: {} } }
        }
      };

      const result = executeQuery(schema, document, variables);
      expect(result.errors).toBeUndefined();
      expect(result.data.foo).toBe(
        JSON.stringify({
          input: { foo: { foo: { foo: { foo: { foo: { foo: {} } } } } } }
        })
      );
    });

    test("should work with multiple variables using the same recursive input type", () => {
      const document = parse(`
        query ($f: FooInput, $g: FooInput) {
          a: foo(input: $f)
          b: foo(input: $g)
        }
      `);
      const variables = {
        f: {
          foo: { foo: { foo: {} } }
        },
        g: {
          foo: {}
        }
      };

      const result = executeQuery(schema, document, variables);
      expect(result.errors).toBeUndefined();
      expect(result.data.a).toBe(
        JSON.stringify({
          input: { foo: { foo: { foo: {} } } }
        })
      );
      expect(result.data.b).toBe(
        JSON.stringify({
          input: { foo: {} }
        })
      );
    });

    test("should work with multiple variables using the same recursive input type - 2 (reverse order)", () => {
      const document = parse(`
        query ($f: FooInput, $g: FooInput) {
          a: foo(input: $g)
          b: foo(input: $f)
        }
      `);
      const variables = {
        g: {
          foo: {}
        },
        f: {
          foo: { foo: { foo: {} } }
        }
      };

      const result = executeQuery(schema, document, variables);
      expect(result.errors).toBeUndefined();
      expect(result.data.b).toBe(
        JSON.stringify({
          input: { foo: { foo: { foo: {} } } }
        })
      );
      expect(result.data.a).toBe(
        JSON.stringify({
          input: { foo: {} }
        })
      );
    });
  });

  describe("simple recursive input - 2", () => {
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          foo(input: FooInput): String
        }
        input FooInput {
          foo: FooInput
          bar: String
        }
      `,
      resolvers: {
        Query: {
          foo(_, args) {
            // used as the actual value in test matchers
            return JSON.stringify(args);
          }
        }
      }
    });

    test("should nòt fail for same leaf values", () => {
      const document = parse(`
        query ($f: FooInput) {
          foo(input: $f)
        }
      `);
      const variables = {
        f: {
          foo: {
            bar: "bar"
          },
          bar: "bar"
        }
      };

      const result = executeQuery(schema, document, variables);
      expect(result.errors).toBeUndefined();
      expect(JSON.parse(result.data.foo).input).toEqual(variables.f);
    });
  });

  describe("mutually recursive input types", () => {
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          products(filter: Filter): String
        }
        input Filter {
          and: AndFilter
          or: OrFilter
          like: String
        }
        input AndFilter {
          left: Filter
          right: Filter
        }
        input OrFilter {
          left: Filter
          right: Filter
        }
      `,
      resolvers: {
        Query: {
          products(_, args) {
            // used as the actual value in test matchers
            return JSON.stringify(args);
          }
        }
      }
    });

    test("should not fail for mutually recursive variables", () => {
      const document = parse(`
        query ($filter1: Filter) {
          products(filter: $filter1)
        }
      `);

      const variables = {
        filter1: {
          and: {
            left: {
              like: "windows"
            },
            right: {
              or: {
                left: {
                  like: "xp"
                },
                right: {
                  like: "vista"
                }
              }
            }
          }
        }
      };

      const result = executeQuery(schema, document, variables);
      expect(JSON.parse(result.data.products).filter).toEqual(
        variables.filter1
      );
    });

    test("should not fail for mutually recursive variables - multiple variables", () => {
      const document = parse(`
        query ($aFilter: Filter, $bFilter: Filter) {
          a: products(filter: $aFilter)
          b: products(filter: $bFilter)
        }
      `);

      const variables = {
        aFilter: {
          and: {
            left: {
              like: "windows"
            },
            right: {
              or: {
                left: {
                  like: "xp"
                },
                right: {
                  like: "vista"
                }
              }
            }
          }
        },
        bFilter: {
          like: "mac",
          or: {
            left: {
              like: "10"
            },
            right: {
              like: "11"
            }
          }
        }
      };

      const result = executeQuery(schema, document, variables);
      expect(JSON.parse(result.data.a).filter).toEqual(variables.aFilter);
      expect(JSON.parse(result.data.b).filter).toEqual(variables.bFilter);
    });

    // when the mutually recursive input type appears at nested level
    // instead of the top-level variable
    test("should not fail for mutually recursive variables - 2", () => {
      const document = parse(`
        query ($macFilter: OrFilter) {
          products(filter: {
            like: "mac"
            and: {
              left: { like: "User" }
              right: { like: "foo" }
            }
            or: $macFilter
          })
        }
      `);

      const variables = {
        macFilter: {
          left: { like: "Applications/Safari" },
          right: { like: "Applications/Notes" }
        }
      };

      const result = executeQuery(schema, document, variables);
      expect(JSON.parse(result.data.products).filter.or).toEqual(
        variables.macFilter
      );
    });
  });

  describe("lists", () => {
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          items(filters: [Filter]): String
        }
        input Filter {
          or: [Filter]
          and: [Filter]
          like: String
        }
      `,
      resolvers: {
        Query: {
          items(_, input) {
            // used as the actual value in test matchers
            return JSON.stringify(input);
          }
        }
      }
    });

    test("should work with recursive types in lists", () => {
      const document = parse(`
        query ($filters: [Filter]) {
          items(filters: $filters)
        }
      `);
      const variables = {
        filters: [
          {
            or: [
              {
                like: "gallery",
                or: [{ like: "photo" }, { like: "video" }]
              }
            ]
          }
        ]
      };

      const result = executeQuery(schema, document, variables);
      expect(result.errors).toBeUndefined();
      expect(JSON.parse(result.data.items).filters).toEqual(variables.filters);
    });
  });

  describe("lists - 2", () => {
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          flatten(list: [[[[[Item]]]]]): String
        }
        input Item {
          id: ID
        }
      `,
      resolvers: {
        Query: {
          flatten(_, input) {
            // used as the actual value in test matchers
            return JSON.stringify(input);
          }
        }
      }
    });

    test("should work with recursive types in lists", () => {
      const document = parse(`
        query ($list: [[[[[Item]]]]]) {
          flatten(list: $list)
        }
      `);
      const variables = {
        list: [
          [[[[{ id: "1" }, { id: "2" }]]]],
          [[[[{ id: "3" }, { id: "4" }]]]]
        ]
      };

      const result = executeQuery(schema, document, variables);
      expect(result.errors).toBeUndefined();
      expect(JSON.parse(result.data.flatten).list).toEqual(variables.list);
    });
  });
});

function executeQuery(
  schema: GraphQLSchema,
  document: DocumentNode,
  variableValues?: any
) {
  const prepared: any = compileQuery(schema, document as any, undefined, {
    useJitVariablesParser: true
  });
  if (!isCompiledQuery(prepared)) {
    return prepared;
  }
  return prepared.query({}, {}, variableValues || {});
}
