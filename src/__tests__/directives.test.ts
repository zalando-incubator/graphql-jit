/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/directives-test.js
 */

import { makeExecutableSchema } from "@graphql-tools/schema";
import { parse } from "graphql";
import { isCompiledQuery } from "../execution";
import { compileQuery } from "../index";

const testSchema = makeExecutableSchema({
  typeDefs: `
    schema {
      query: TestType
    }
    type TestType {
      a: String
      b: String
    }
  `,
  resolvers: {
    TestType: {
      a: () => "a",
      b: () => "b"
    }
  }
});

const data = {};

function executeTestQuery(query: string, variables = {}, schema = testSchema) {
  const ast = parse(query);
  const compiled: any = compileQuery(schema, ast, "", { debug: true } as any);
  if (!isCompiledQuery(compiled)) {
    return compiled;
  }
  return compiled.query(data, undefined, variables);
}

// tslint:disable-next-line
describe("Execute: handles directives", () => {
  describe("works without directives", () => {
    test("basic query works", () => {
      const result = executeTestQuery("{ a, b }");

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });
  });

  describe("works on scalars", () => {
    // tslint:disable-next-line
    test("if true includes scalar", () => {
      const result = executeTestQuery("{ a, b @include(if: true) }");

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });

    test("if false omits on scalar", () => {
      const result = executeTestQuery("{ a, b @include(if: false) }");

      expect(result).toEqual({
        data: { a: "a" }
      });
    });

    // tslint:disable-next-line
    test("unless false includes scalar", () => {
      const result = executeTestQuery("{ a, b @skip(if: false) }");

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });

    // tslint:disable-next-line
    test("unless true omits scalar", () => {
      const result = executeTestQuery("{ a, b @skip(if: true) }");

      expect(result).toEqual({
        data: { a: "a" }
      });
    });
  });

  describe("works on fragment spreads", () => {
    test("if false omits fragment spread", () => {
      const result = executeTestQuery(`
        query {
          a
          ...Frag @include(if: false)
        }
        fragment Frag on TestType {
          b
        }
      `);

      expect(result).toEqual({
        data: { a: "a" }
      });
    });

    test("if true includes fragment spread", () => {
      const result = executeTestQuery(`
        query {
          a
          ...Frag @include(if: true)
        }
        fragment Frag on TestType {
          b
        }
      `);

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });

    test("unless false includes fragment spread", () => {
      const result = executeTestQuery(`
        query {
          a
          ...Frag @skip(if: false)
        }
        fragment Frag on TestType {
          b
        }
      `);

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });

    test("unless true omits fragment spread", () => {
      const result = executeTestQuery(`
        query {
          a
          ...Frag @skip(if: true)
        }
        fragment Frag on TestType {
          b
        }
      `);

      expect(result).toEqual({
        data: { a: "a" }
      });
    });
  });

  describe("works on inline fragment", () => {
    test("if false omits inline fragment", () => {
      const result = executeTestQuery(`
        query {
          a
          ... on TestType @include(if: false) {
            b
          }
        }
      `);

      expect(result).toEqual({
        data: { a: "a" }
      });
    });

    test("if true includes inline fragment", () => {
      const result = executeTestQuery(`
        query {
          a
          ... on TestType @include(if: true) {
            b
          }
        }
      `);

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });
    test("unless false includes inline fragment", () => {
      const result = executeTestQuery(`
        query {
          a
          ... on TestType @skip(if: false) {
            b
          }
        }
      `);

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });
    test("unless true includes inline fragment", () => {
      const result = executeTestQuery(`
        query {
          a
          ... on TestType @skip(if: true) {
            b
          }
        }
      `);

      expect(result).toEqual({
        data: { a: "a" }
      });
    });
  });

  describe("works on anonymous inline fragment", () => {
    test("if false omits anonymous inline fragment", () => {
      const result = executeTestQuery(`
        query {
          a
          ... @include(if: false) {
            b
          }
        }
      `);

      expect(result).toEqual({
        data: { a: "a" }
      });
    });

    test("if true includes anonymous inline fragment", () => {
      const result = executeTestQuery(`
        query {
          a
          ... @include(if: true) {
            b
          }
        }
      `);

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });
    test("unless false includes anonymous inline fragment", () => {
      const result = executeTestQuery(`
        query Q {
          a
          ... @skip(if: false) {
            b
          }
        }
      `);

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });

    test("unless true includes anonymous inline fragment", () => {
      const result = executeTestQuery(`
        query {
          a
          ... @skip(if: true) {
            b
          }
        }
      `);

      expect(result).toEqual({
        data: { a: "a" }
      });
    });
  });

  describe("works with skip and include directives", () => {
    test("include and no skip", () => {
      const result = executeTestQuery(`
        {
          a
          b @include(if: true) @skip(if: false)
        }
      `);

      expect(result).toEqual({
        data: { a: "a", b: "b" }
      });
    });

    test("include and skip", () => {
      const result = executeTestQuery(`
        {
          a
          b @include(if: true) @skip(if: true)
        }
      `);

      expect(result).toEqual({
        data: { a: "a" }
      });
    });

    test("no include or skip", () => {
      const result = executeTestQuery(`
        {
          a
          b @include(if: false) @skip(if: false)
        }
      `);

      expect(result).toEqual({
        data: { a: "a" }
      });
    });
  });

  describe("skip include directives", () => {
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          foo: Foo
        }
        type Foo {
          a: String
          b: Int
          bar: Bar
        }
        type Bar {
          c: String
          d: String
        }
      `,
      resolvers: {
        Query: {
          foo: () => ({
            b: 42
          })
        },
        Foo: {
          bar() {
            return {
              c: "ccc",
              d: "ddd"
            };
          },
          a() {
            return "aa";
          }
        }
      }
    });

    test("skip on field", async () => {
      const query = `
        query ($skip: Boolean!) {
          foo @skip(if: $skip) {
            a
          }
        }
      `;
      const result = await executeTestQuery(query, { skip: true }, schema);
      expect(result).toEqual({
        data: {}
      });
    });

    test("include on field", async () => {
      const query = `
        query ($include: Boolean!) {
          foo @include(if: $include) {
            a
          }
        }
      `;
      const result = await executeTestQuery(query, { include: false }, schema);
      expect(result).toEqual({
        data: {}
      });
    });

    test("skip on field nested", async () => {
      const query = `
        query ($skipFoo: Boolean!, $skipA: Boolean!) {
          foo @skip(if: $skipFoo) {
            a @skip(if: $skipA)
          }
        }
      `;
      const result = await executeTestQuery(
        query,
        { skipFoo: false, skipA: true },
        schema
      );
      expect(result).toEqual({
        data: { foo: {} }
      });
    });

    describe("skip vs include on field", () => {
      const query = `
        query ($skip: Boolean!, $include: Boolean!) {
          foo @skip(if: $skip) @include(if: $include) {
            a
          }
        }
      `;
      function exec(skip: boolean, include: boolean) {
        return executeTestQuery(query, { skip, include }, schema);
      }
      test("skip=false, include=false", async () => {
        const result = await exec(false, false);
        expect(result).toEqual({
          data: {}
        });
      });
      test("skip=false, include=true", async () => {
        const result = await exec(false, true);
        expect(result).toEqual({
          data: { foo: { a: "aa" } }
        });
      });
      test("skip=true, include=false", async () => {
        const result = await exec(true, false);
        expect(result).toEqual({
          data: {}
        });
      });
      test("skip=true, include=true", async () => {
        const result = await exec(true, true);
        expect(result).toEqual({
          data: {}
        });
      });
    });

    describe("fragments", () => {
      test("inline fragments", async () => {
        const query = `
          query ($skip: Boolean!) {
            ... @skip(if: $skip) {
              foo {
                a
              }
            }
          }
        `;
        const result = await executeTestQuery(query, { skip: true }, schema);
        expect(result).toEqual({
          data: {}
        });
      });

      test("named fragment", async () => {
        const query = `
          query ($skip: Boolean!) {
            ...x @skip(if: $skip)
          }
          fragment x on Query {
            foo {
              a
            }
          }
        `;
        const result = await executeTestQuery(query, { skip: true }, schema);
        expect(result).toEqual({
          data: {}
        });
      });

      describe("spread same fragment on multiple directives", () => {
        const query = `
          query (
            $includeVar: Boolean!,
            $skipVar: Boolean!,
            $fieldVar:Boolean!
            ) {
            foo{
              bar1:bar @skip(if: $skipVar){
                ...barFragment
              }
              bar2:bar @include(if: $includeVar){
                ...barFragment
              }
            }
          }
          fragment barFragment on Bar {
            c
            d @include(if: $fieldVar)
          }
        `;
        function exec(skipVar: boolean, includeVar: boolean, fieldVar: boolean) {
          return executeTestQuery(
            query,
            { includeVar, skipVar, fieldVar },
            schema
          );
        }
        /*
          +---------+------------+----------+------+------+---+
          | skipVar | includeVar | fieldVar | bar1 | bar2 | d |
          +---------+------------+----------+------+------+---+
          |       0 |          0 |        0 |    1 |    0 | 0 |
          |       0 |          0 |        1 |    1 |    0 | 1 |
          |       0 |          1 |        0 |    1 |    1 | 0 |
          |       0 |          1 |        1 |    1 |    1 | 1 |
          |       1 |          0 |        0 |    0 |    0 | 0 |
          |       1 |          0 |        1 |    0 |    0 | 0 |
          |       1 |          1 |        0 |    0 |    1 | 0 |
          |       1 |          1 |        1 |    0 |    1 | 1 |
          +---------+------------+----------+------+------+---+
         */
        test("one spread not skipped, one spread not included, one field not included", async () => {
          const result = exec(false, false, false);
          expect(result).toEqual({
            data: {
              foo: {
                bar1: {
                  c: "ccc",
                }
              }
            }
          });
        });

        test("one spread not skipped, one spread not included, one field included", async () => {
          const result = exec(false, false, true);
          expect(result).toEqual({
            data: {
              foo: {
                bar1: {
                  c: "ccc",
                  d: "ddd",
                }
              }
            }
          });
        });

        test("one spread not skipped, one spread included, one field not included", async () => {
          const result = exec(false, true, false);
          expect(result).toEqual({
            data: {
              foo: {
                bar1: {
                  c: "ccc",
                },
                bar2: {
                  c: "ccc",
                }
              }
            }
          });
        });

        test("one spread not skipped, one spread included, one field included", async () => {
          const result = exec(false, true, true);
          expect(result).toEqual({
            data: {
              foo: {
                bar1: {
                  c: "ccc",
                  d: "ddd",
                },
                bar2: {
                  c: "ccc",
                  d: "ddd",
                }
              }
            }
          });
        });

        test("one spread skipped, one spread not included, one field not included", async () => {
          const result = exec(true, false, false);
          expect(result).toEqual({
            data: {
              foo: {}
            }
          });
        });

        test("one spread skipped, one spread not included, one field included", async () => {
          const result = exec(true, false, true);
          expect(result).toEqual({
            data: {
              foo: {}
            }
          });
        });

        test("one spread skipped, one spread included, one field not included", async () => {
          const result = exec(true, true, false);
          expect(result).toEqual({
            data: {
              foo: {
                bar2: {
                  c: "ccc",
                }
              }
            }
          });
        });

        test("one spread skipped, one spread included, one field included", async () => {
          const result = exec(true, true, true);
          expect(result).toEqual({
            data: {
              foo: {
                bar2: {
                  c: "ccc",
                  d: "ddd",
                }
              }
            }
          });
        });
      });
    });

    describe("nested fragments", () => {
      const query = `
        query ($skip1: Boolean!, $skip2: Boolean!, $include1: Boolean!, $include2: Boolean!) {
          ...x @skip(if: $skip1)
          ... @include(if: $include1) {
            foo {
              a
            }
          }
        }
        fragment x on Query {
          ... @skip(if: $skip2) {
            foo {
              a @include(if: $include2)
            }
          }
        }
      `;
      function exec(
        skip1: boolean,
        skip2: boolean,
        include1: boolean,
        include2: boolean
      ) {
        return executeTestQuery(
          query,
          { skip1, skip2, include1, include2 },
          schema
        );
      }

      test("all skipped", async () => {
        const result = await exec(true, true, false, false);
        expect(result).toEqual({ data: {} });
      });

      test("at least one include resolves field", async () => {
        const result = await exec(true, true, true, false);
        expect(result).toEqual({ data: { foo: { a: "aa" } } });
      });

      test("correct skip and include are applied", async () => {
        const result = await exec(false, false, false, false);
        expect(result).toEqual({ data: { foo: {} } });
      });

      test("correct skip and include are applied - 2", async () => {
        const result = await exec(false, false, false, true);
        expect(result).toEqual({ data: { foo: { a: "aa" } } });
      });

      test("skip follows the tree top down", async () => {
        const result = await exec(true, false, false, false);
        expect(result).toEqual({ data: {} });
      });

      test("skip follows the tree top down (include true)", async () => {
        const result = await exec(true, false, true, false);
        expect(result).toEqual({ data: { foo: { a: "aa" } } });
      });
    });

    describe("nested - non top-level fields", () => {
      const query = `
        query ($skip1: Boolean!, $skip2: Boolean!, $include1: Boolean!, $include2: Boolean!) {
          foo {
            ...aFragment @skip(if: $skip1)
            ... @skip(if: $skip2) {
              b
            }
            ...barFragment
          }
        }
        fragment aFragment on Foo {
          a
        }
        fragment barFragment on Foo {
          ... @include(if: $include1) {
            bar {
              d
              ...cFragment
            }
          }
        }
        fragment cFragment on Bar {
          ... @include(if: $include2) {
            c
          }
        }
      `;
      function exec(
        skip1: boolean,
        skip2: boolean,
        include1: boolean,
        include2: boolean
      ) {
        return executeTestQuery(
          query,
          { skip1, skip2, include1, include2 },
          schema
        );
      }

      test("all skipped", async () => {
        const result = await exec(true, true, false, false);
        expect(result).toEqual({ data: { foo: {} } });
      });
    });

    describe("nested fragments - skip/include propagation", () => {
      const query = `
        query ($foo: Boolean!, $d: Boolean!) {
          foo @skip(if: $foo) {
            bar {
              d
            }
          }
          ... {
            foo {
              bar {
                d @skip(if: $d)
              }
            }
          }
        }
      `;

      test("skip foo = true, skip d = true", async () => {
        const result = await executeTestQuery(
          query,
          { foo: true, d: true },
          schema
        );
        expect(result).toEqual({ data: { foo: { bar: {} } } });
      });

      test("skip foo = false, skip d = true", async () => {
        const result = await executeTestQuery(
          query,
          { foo: false, d: true },
          schema
        );
        expect(result).toEqual({ data: { foo: { bar: { d: "ddd" } } } });
      });
    });

    describe("error scenarios", () => {
      test("missing if", async () => {
        const query = `
          query ($skip: Boolean!) {
            foo @skip {
              a
            }
          }
        `;
        const result = await executeTestQuery(query, { skip: true }, schema);
        expect(result).toEqual({
          errors: [
            expect.objectContaining({
              message: "Directive 'skip' is missing required arguments: 'if'"
            })
          ]
        });
      });

      test("invalid type for if", async () => {
        const query = `
          query {
            foo @skip(if: 0) {
              a
            }
          }
        `;
        const result = await executeTestQuery(query, { skip: 0 }, schema);
        expect(result).toEqual({
          errors: [
            expect.objectContaining({
              message:
                "Argument 'if' on Directive 'skip' has an invalid value (0). Expected type 'Boolean!'"
            })
          ]
        });
      });

      test("invalid variable for if - variable not defined", async () => {
        const query = `
          query {
            foo @skip(if: $skip) {
              a
            }
          }
        `;
        const result = await executeTestQuery(query, { skip: 0 }, schema);
        expect(result).toEqual({
          errors: [
            expect.objectContaining({
              message: `Variable 'skip' is not defined`
            })
          ]
        });
      });

      test("invalid type for if - variable", async () => {
        const query = `
          query ($skip: Int!) {
            foo @skip(if: $skip) {
              a
            }
          }
        `;
        const result = await executeTestQuery(query, { skip: 0 }, schema);
        expect(result).toEqual({
          errors: [
            expect.objectContaining({
              message: `Variable 'skip' of type 'Int!' used in position expecting type 'Boolean!'`
            })
          ]
        });
      });

      test("invalid type for if - variable - 2", async () => {
        const query = `
          query ($skip: [Int!]!) {
            foo @skip(if: $skip) {
              a
            }
          }
        `;
        const result = await executeTestQuery(query, { skip: [0] }, schema);
        expect(result).toEqual({
          errors: [
            expect.objectContaining({
              message: `Variable 'skip' of type '[Int!]!' used in position expecting type 'Boolean!'`
            })
          ]
        });
      });
    });
  });

  describe("resolver invoking", () => {
    const getSchema = (mockResolver: jest.Mock<string, any[]>) =>
      makeExecutableSchema({
        typeDefs: `
        type Query {
          foo: String
        }
      `,
        resolvers: {
          Query: {
            foo: mockResolver
          }
        }
      });
    const query = `
      query ($skip: Boolean!) {
        foo @skip(if: $skip)
      }
    `;

    test("resolver should not be called if skipped", async () => {
      const mockResolver = jest.fn(() => "mock-resolver-not-called");
      const result = executeTestQuery(
        query,
        { skip: true },
        getSchema(mockResolver)
      );
      expect(result.data.foo).toBeUndefined();
      expect(mockResolver).not.toHaveBeenCalled();
    });

    test("resolver should be called if not skipped", async () => {
      const mockResolver = jest.fn(() => "mock-resolver-called");
      const result = executeTestQuery(
        query,
        { skip: false },
        getSchema(mockResolver)
      );
      expect(result.data.foo).toBe("mock-resolver-called");
      expect(mockResolver).toHaveBeenCalled();
    });
  });
});
