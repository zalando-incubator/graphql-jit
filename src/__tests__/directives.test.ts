/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/directives-test.js
 */

import { parse } from "graphql";
import { compileQuery } from "../index";
import { makeExecutableSchema } from "graphql-tools";
import { isCompiledQuery } from "../execution";

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
    console.error(compiled);
    throw new Error("compilation failed");
  }
  // console.log(compiled.__DO_NOT_USE_THIS_OR_YOU_WILL_BE_FIRED_compilation);
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

  describe.only("skip include directives", () => {
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
    });

    describe("nested fragments", () => {
      const query = `
       # TRUE, true, true, false
        query ($skip1: Boolean!, $skip2: Boolean!, $include1: Boolean!, $include2: Boolean) {
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

      test.only("all skipped", async () => {
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
        expect(result).toEqual({ data: { foo: {} } });
      });
    });

    describe("nested - non top-level fields", () => {
      const query = `
        query ($skip1: Boolean!, $skip2: Boolean!, $include1: Boolean!, $include2: Boolean) {
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
  });
});
