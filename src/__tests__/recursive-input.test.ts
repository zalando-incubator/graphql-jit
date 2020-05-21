import { DocumentNode, GraphQLSchema, parse, validate } from "graphql";
import { makeExecutableSchema } from "graphql-tools";
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

    test("should not fail for recursive input without variables", () => {
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

    // Reminder to self
    // TODO(boopathi): write tests to handle same value inputs
    // { foo: 3, bar: 3 }
    // Solution: object types only

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

    test("should capture and throw error when recursive value is passed", () => {
      const document = parse(`
        query ($f: FooInput) {
          foo(input: $f)
        }
      `);
      const variables: any = {
        f: {
          foo: { foo: { foo: {} } }
        }
      };
      variables.f.foo = variables.f;

      const result = executeQuery(schema, document, variables);
      expect(result.errors[0].message).toBe(
        "Circular reference detected in input variable '$f' at foo.foo"
      );
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

    test("should throw for mutually recursive runtime values", () => {
      const document = parse(`
        query ($filter1: Filter) {
          products(filter: $filter1)
        }
      `);

      const variables: any = {
        filter1: {
          and: {
            left: {}
          },
          or: {
            left: {}
          }
        }
      };
      // create mututal recursion at
      // and.left.or.left.and <-> or.left.and.left.or
      variables.filter1.and.left.or = variables.filter1.or;
      variables.filter1.or.left.and = variables.filter1.and;

      const result = executeQuery(schema, document, variables);
      expect(result.errors[0].message).toBe(
        "Circular reference detected in input variable '$filter1' at and.left.or.left.and"
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

    test("should throw error for runtime circular dependencies in lists", () => {
      const document = parse(`
        query ($filters: [Filter]) {
          items(filters: $filters)
        }
      `);
      const variables: any = {
        filters: [{}]
      };
      variables.filters[0].or = variables.filters;

      const result = executeQuery(schema, document, variables);
      expect(result.errors[0].message).toBe(
        `Circular reference detected in input variable '$filters' at 0.or.0`
      );
    });

    test("should throw error for runtime circular dependencies in lists - 2", () => {
      const document = parse(`
        query ($filters: [Filter]) {
          items(filters: $filters)
        }
      `);
      const variables: any = {
        filters: [
          {
            or: [
              {
                like: "gallery",
                or: [{ like: "photo" }]
              }
            ]
          }
        ]
      };
      variables.filters[0].or[0].or[0].or = variables.filters;

      const result = executeQuery(schema, document, variables);
      expect(result.errors[0].message).toBe(
        `Circular reference detected in input variable '$filters' at 0.or.0.or.0.or.0`
      );
    });

    test("should throw error for runtime circular dependencies in lists - 3", () => {
      const document = parse(`
        query ($filters: [Filter]) {
          items(filters: $filters)
        }
      `);
      const variables: any = {
        filters: [
          {
            or: [
              {
                and: [{ like: "foo" }, { like: "bar" }]
              }
            ]
          }
        ]
      };
      variables.filters[0].or[1] = variables.filters[0];

      const result = executeQuery(schema, document, variables);
      expect(result.errors[0].message).toBe(
        `Circular reference detected in input variable '$filters' at 0.or.1`
      );
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

    test("should throw when lists are circular referenced", () => {
      const document = parse(`
        query ($list: [[[[[Item]]]]]) {
          flatten(list: $list)
        }
      `);
      const variables: any = {
        list: []
      };
      variables.list.push(variables.list);

      const result = executeQuery(schema, document, variables);
      expect(result.errors[0].message).toBe(
        "Circular reference detected in input variable '$list' at 0.0"
      );
    });

    test("should throw when lists are mutually circular referenced", () => {
      const document = parse(`
        query ($list: [[[[[Item]]]]]) {
          flatten(list: $list)
        }
      `);
      const variables: any = {
        list: [[], []]
      };
      variables.list[0].push(variables.list[1]);
      variables.list[1].push(variables.list[0]);

      const result = executeQuery(schema, document, variables);
      expect(result.errors[0].message).toBe(
        "Circular reference detected in input variable '$list' at 0.0.0"
      );
    });
  });
});

function executeQuery(
  schema: GraphQLSchema,
  document: DocumentNode,
  variableValues?: any,
  rootValue?: any,
  contextValue?: any,
  operationName?: string
) {
  const prepared: any = compileQuery(schema, document as any, operationName);
  if (!isCompiledQuery(prepared)) {
    return prepared;
  }
  return prepared.query(rootValue, contextValue, variableValues || {});
}
