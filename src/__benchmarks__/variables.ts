#!/usr/bin/env node -r @swc-node/register

/**
 * Benchmarks variable coercion in isolation and end to end.
 *
 *   NODE_ENV=production node --loader @swc-node/register/esm src/__benchmarks__/variables.ts
 *
 * Recursive input types can only be compiled once circular inputs are
 * supported. When the recursive schema fails to compile, the benchmark falls
 * back to an unrolled (non-recursive) schema of the same shape and depth, so
 * that the numbers stay comparable across branches.
 */
import Benchmark from "benchmark";
import {
  buildSchema,
  type DocumentNode,
  execute,
  getVariableValues,
  type GraphQLSchema,
  type OperationDefinitionNode,
  parse
} from "graphql";
import { compileQuery, isCompiledQuery, isPromise } from "../execution";
import { compileVariableParsing } from "../variables";

function getVariablesParser(schema: GraphQLSchema, document: DocumentNode) {
  const op = document.definitions[0] as OperationDefinitionNode;
  return compileVariableParsing(schema, op.variableDefinitions || []);
}

function filterTypeDefs(levels: number, recursive: boolean) {
  const common = `
    type Query { products(filter: Filter): [Product] }
    type Product { id: ID! name: String! }
  `;
  if (recursive) {
    return `${common}
      input Filter { and: AndFilter or: OrFilter like: String }
      input AndFilter { left: Filter right: Filter }
      input OrFilter { left: Filter right: Filter }
    `;
  }
  let defs = common;
  for (let i = 0; i < levels; i++) {
    const name = i === 0 ? "Filter" : `Filter${i}`;
    if (i === levels - 1) {
      defs += `input ${name} { like: String }\n`;
      continue;
    }
    defs += `
      input ${name} { and: AndFilter${i} or: OrFilter${i} like: String }
      input AndFilter${i} { left: Filter${i + 1} right: Filter${i + 1} }
      input OrFilter${i} { left: Filter${i + 1} right: Filter${i + 1} }
    `;
  }
  return defs;
}

// A balanced and/or tree whose leaves sit at the given depth.
function filterValue(depth: number, i = 0): any {
  if (depth === 0) return { like: `term${i}` };
  const op = depth % 2 === 0 ? "and" : "or";
  return {
    [op]: {
      left: filterValue(depth - 1, i * 2),
      right: filterValue(depth - 1, i * 2 + 1)
    }
  };
}

function filterSchema(depth: number) {
  const resolvers = { products: [] };
  try {
    const schema = buildSchema(filterTypeDefs(0, true));
    getVariablesParser(schema, filterQuery);
    return { schema, recursive: true, rootValue: resolvers };
  } catch {
    // +1: leaves are Filter nodes as well
    const schema = buildSchema(filterTypeDefs(depth + 1, false));
    return { schema, recursive: false, rootValue: resolvers };
  }
}

const filterQuery = parse(`
  query ($filter: Filter) {
    products(filter: $filter) { id name }
  }
`);

const flatSchema = buildSchema(`
  type Query { search(input: SearchInput!): Boolean }
  enum Sort { ASC DESC }
  input Range { from: Int to: Int }
  input Item { id: ID! name: String! quantity: Int price: Float tags: [String!] }
  input SearchInput {
    query: String!
    page: Int
    pageSize: Int
    sort: Sort
    exact: Boolean
    price: Range
    items: [Item!]
  }
`);

const flatQuery = parse(`
  query ($input: SearchInput!) { search(input: $input) }
`);

const flatVariables = {
  input: {
    query: "shoes",
    page: 1,
    pageSize: 50,
    sort: "DESC",
    exact: false,
    price: { from: 10, to: 100 },
    items: Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      name: `item ${i}`,
      quantity: i,
      price: i * 1.5,
      tags: ["a", "b", "c"]
    }))
  }
};

interface Material {
  schema: GraphQLSchema;
  query: DocumentNode;
  variables: any;
  rootValue?: any;
  note?: string;
}

function filterMaterial(depth: number): Material | undefined {
  const { schema, recursive, rootValue } = filterSchema(depth);
  // The unrolled schema grows exponentially with depth (4 branches per level)
  // and the inlined code no longer fits in V8 beyond a few levels.
  if (!recursive && depth > 5) return undefined;
  return {
    schema,
    query: filterQuery,
    variables: { filter: filterValue(depth) },
    rootValue,
    note: recursive ? "recursive schema" : "unrolled schema"
  };
}

const materials: Record<string, Material | undefined> = {
  filterDepth3: filterMaterial(3),
  filterDepth5: filterMaterial(5),
  filterDepth8: filterMaterial(8),
  flatWithList: {
    schema: flatSchema,
    query: flatQuery,
    variables: flatVariables,
    rootValue: { search: true }
  }
};

async function run() {
  const filter = process.env.BENCHMARK_FILTER;
  for (const [name, m] of Object.entries(materials)) {
    if (filter && !new RegExp(filter).test(name)) continue;
    if (!m) {
      console.log(`\n${name}: skipped (needs recursive input support)`);
      continue;
    }
    const op = m.query.definitions[0] as OperationDefinitionNode;
    const varDefs = op.variableDefinitions || [];
    const parse = getVariablesParser(m.schema, m.query);
    const compiled = compileQuery(m.schema, m.query);
    if (!isCompiledQuery(compiled)) {
      throw new Error(`${name} failed to compile`);
    }
    const jit: any = parse(m.variables);
    const js: any = getVariableValues(m.schema, varDefs, m.variables);
    // graphql 17 nests the coerced values under `variableValues`
    const jsCoerced = js.variableValues
      ? js.variableValues.coerced
      : js.coerced;
    if (
      jit.errors ||
      js.errors ||
      JSON.stringify(jit.coerced) !== JSON.stringify(jsCoerced)
    ) {
      throw new Error(
        `${name}: JIT coercion differs from graphql-js\n${JSON.stringify(
          jit
        )}\n${JSON.stringify(js)}`
      );
    }
    const e2eJs = await execute({
      schema: m.schema,
      document: m.query,
      variableValues: m.variables,
      rootValue: m.rootValue
    });
    const e2eJit = await compiled.query(m.rootValue, undefined, m.variables);
    if (JSON.stringify(e2eJs) !== JSON.stringify(e2eJit)) {
      throw new Error(
        `${name}: execution result differs from graphql-js ${JSON.stringify(
          e2eJs
        )} ${JSON.stringify(e2eJit)}`
      );
    }

    if (isPromise(compiled.query(m.rootValue, undefined, m.variables))) {
      throw new Error(`${name}: expected a synchronous execution`);
    }

    console.log(`\n${name} (${m.note ?? "non-recursive"})`);
    new Benchmark.Suite(name)
      .add("variables: graphql-js", () =>
        getVariableValues(m.schema, varDefs, m.variables)
      )
      .add("variables: graphql-jit", () => parse(m.variables))
      .add("e2e: graphql-jit", () =>
        compiled.query(m.rootValue, undefined, m.variables)
      )
      .on("cycle", (e: any) => console.log("  " + String(e.target)))
      .on("error", (e: any) => console.error(e.target.error))
      .run();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
