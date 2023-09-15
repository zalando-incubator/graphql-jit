#!/usr/bin/env node -r @swc-node/register

import Benchmark from "benchmark";
import minimist from "minimist";
import {
  DocumentNode,
  execute,
  getIntrospectionQuery,
  GraphQLSchema,
  parse
} from "graphql";
import {
  compileQuery,
  CompilerOptions,
  isCompiledQuery,
  isPromise
} from "../execution";
import {
  query as fewResolversQuery,
  schema as fewResolversSchema
} from "./schema-few-resolvers";
import {
  query as manyResolverQuery,
  schema as manyResolverSchema
} from "./schema-many-resolvers";
import {
  query as nestedArrayQuery,
  schema as nestedArraySchema
} from "./schema-nested-array";
import {
  query as variablesShallowQuery,
  schema as variablesShallowSchema,
  variables as variablesShallowVariables
} from "./variables-parsing-shallow";

interface BenchmarkMaterial {
  query: DocumentNode;
  schema: GraphQLSchema;
  variables?: any;
  options?: Partial<CompilerOptions>;
}

const benchmarks: { [key: string]: BenchmarkMaterial } = {
  introspection: {
    schema: nestedArraySchema(),
    query: parse(getIntrospectionQuery({ descriptions: true }))
  },
  fewResolvers: {
    schema: fewResolversSchema(),
    query: fewResolversQuery,
    variables: { id: "2", width: 300, height: 500 }
  },
  manyResolvers: {
    schema: manyResolverSchema(),
    query: manyResolverQuery,
    variables: { id: "2", width: 300, height: 500 }
  },
  nestedArrays: {
    schema: nestedArraySchema(),
    query: nestedArrayQuery,
    variables: { id: "2", width: 300, height: 500 }
  },
  variablesShallowWithCompilation: {
    schema: variablesShallowSchema(),
    query: variablesShallowQuery,
    variables: variablesShallowVariables,
    options: {
      useJitVariablesParser: true
    }
  },
  variablesShallowWithoutCompilation: {
    schema: variablesShallowSchema(),
    query: variablesShallowQuery,
    variables: variablesShallowVariables,
    options: {
      useJitVariablesParser: false
    }
  }
};

async function runBenchmarks(argv: string[]) {
  const args = minimist(argv);
  const help = args["help"];

  const availableBenchmarks = Object.entries(benchmarks);

  if (help) {
    console.log(
      `
Usage: yarn benchmark [options]

Options:
  --skip-js    Skip graphql-js benchmarks
  --skip-json  Skip JSON.stringify benchmarks
  --help       Show this help
  --bench      Run only the specified benchmarks (comma separated)

Available benchmarks:
${availableBenchmarks.map(([bench]) => `  - ${bench}`).join("\n")}
`.trim()
    );
    return;
  }

  const skipJS = args["skip-js"];
  const skipJSON = args["skip-json"];
  const benchsToRunArg = args["bench"];
  const benchmarksToRun =
    benchsToRunArg && benchsToRunArg.split(",").filter((b: string) => b);

  const filteredBenchmarks = benchmarksToRun
    ? availableBenchmarks.filter(([bench]) => benchmarksToRun.includes(bench))
    : availableBenchmarks;

  const benchs = await Promise.all(
    filteredBenchmarks.map(async ([bench, { query, schema, variables }]) => {
      const compiledQuery = compileQuery(schema, query, undefined, {
        debug: true
      } as any);
      if (!isCompiledQuery(compiledQuery)) {
        // eslint-disable-next-line no-console
        console.error(`${bench} failed to compile`);
        return null;
      }
      // eslint-disable-next-line no-console
      console.log(
        `size of function for ${bench}: ${
          (compiledQuery as any)
            .__DO_NOT_USE_THIS_OR_YOU_WILL_BE_FIRED_compilation.length
        }`
      );
      const graphqlJsResult = await execute({
        schema,
        document: query,
        variableValues: variables || {}
      });
      const graphqlJitResult = await compiledQuery.query(
        undefined,
        undefined,
        variables || {}
      );
      if (
        JSON.stringify(graphqlJitResult) !== JSON.stringify(graphqlJsResult)
      ) {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify(graphqlJitResult),
          "is different of",
          JSON.stringify(graphqlJsResult)
        );
        return null;
      }
      const suite = new Benchmark.Suite(bench);
      if (!skipJS) {
        suite.add("graphql-js", {
          minSamples: 150,
          defer: true,
          fn(deferred: any) {
            const result = execute({
              schema,
              document: query,
              variableValues: variables || {}
            });
            if (isPromise(result)) {
              return result.then((res) =>
                deferred.resolve(skipJSON ? res : JSON.stringify(res))
              );
            }
            return deferred.resolve(skipJSON ? result : JSON.stringify(result));
          }
        });
      }
      suite
        .add("graphql-jit", {
          minSamples: 150,
          defer: true,
          fn(deferred: any) {
            const result = compiledQuery.query(
              undefined,
              undefined,
              variables || {}
            );
            if (isPromise(result)) {
              return result.then((res) =>
                deferred.resolve(skipJSON ? res : compiledQuery.stringify(res))
              );
            }
            return deferred.resolve(
              skipJSON ? result : compiledQuery.stringify(result)
            );
          }
        })
        // add listeners
        .on("cycle", (event: any) => {
          // eslint-disable-next-line no-console
          console.log(String(event.target));
        })
        .on("start", () => {
          // eslint-disable-next-line no-console
          console.log("Starting", bench);
        });
      return suite;
    })
  );

  const benchsToRun = benchs.filter(isNotNull);
  let benchRunning = 1;
  benchsToRun.forEach((bench) =>
    bench.on("complete", () => {
      if (benchRunning < benchsToRun.length) {
        benchsToRun[benchRunning++].run();
      }
    })
  );
  if (benchsToRun.length > 0) {
    benchsToRun[0].run();
  } else {
    // eslint-disable-next-line
    console.log("No benchmarks to run");
  }
}

// eslint-disable-next-line
runBenchmarks(process.argv.slice(2)).catch(console.error);

function isNotNull<T>(a: T | null | undefined): a is T {
  return a != null;
}
