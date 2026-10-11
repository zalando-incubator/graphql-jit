import {
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { compileQuery, isCompiledQuery } from "../index";

// Input values from the query and the schema are written into the generated
// source, so they must come back as data and never run as code.
const payload = '"); globalThis.__injected = true; ("';
const quoted = JSON.stringify(payload);

const Input = new GraphQLInputObjectType({
  name: "Input",
  fields: { s: { type: GraphQLString, defaultValue: payload } }
});
const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: {
      f: {
        type: GraphQLString,
        args: {
          a: { type: GraphQLString, defaultValue: payload },
          i: { type: Input }
        },
        resolve: (_source, { a, i }) => (i ? i.s : a)
      }
    }
  })
});

afterEach(() => {
  expect((globalThis as any).__injected).toBeUndefined();
});

test.each([
  ["an argument literal", `{ f(a: ${quoted}) }`, {}],
  ["an input object literal", `{ f(i: {s: ${quoted}}) }`, {}],
  ["a variable default", `query ($v: String = ${quoted}) { f(a: $v) }`, {}],
  ["an argument default", "{ f }", {}],
  ["an input field default", "query ($v: Input) { f(i: $v) }", { v: {} }]
])("%s is written into the source as data", async (_name, query, vars) => {
  const compiled = compileQuery(schema, parse(query));
  if (!isCompiledQuery(compiled)) {
    throw new Error("expected a compiled query");
  }
  expect(await compiled.query(undefined, undefined, vars)).toEqual({
    data: { f: payload }
  });
});
