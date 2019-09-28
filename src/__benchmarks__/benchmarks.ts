import Benchmark from "benchmark";
import {
  DocumentNode,
  execute,
  getIntrospectionQuery,
  GraphQLSchema,
  parse
} from "graphql";
import { compileQuery, isCompiledQuery, isPromise } from "../execution";
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

interface BenchmarkMaterial {
  query: DocumentNode;
  schema: GraphQLSchema;
  variables?: any;
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
  }
};

async function runBenchmarks() {
  const skipJS = process.argv[2] === "skip-js";
  const skipJSON = process.argv[2] === "skip-json";
  const benchs = await Promise.all(
    Object.entries(benchmarks).map(
      async ([bench, { query, schema, variables }]) => {
        const compiledQuery = compileQuery(schema, query, undefined);
        if (!isCompiledQuery(compiledQuery)) {
          // tslint:disable-next-line
          console.error(`${bench} failed to compile`);
          return null;
        }

        const graphqlJsResult = await execute(
          schema,
          query,
          undefined,
          undefined,
          variables || {}
        );
        const graphqlJitResult = await compiledQuery.query(
          undefined,
          undefined,
          variables || {}
        );
        if (
          JSON.stringify(graphqlJitResult) !== JSON.stringify(graphqlJsResult)
        ) {
          // tslint:disable-next-line
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
              const result = execute(
                schema,
                query,
                undefined,
                undefined,
                variables || {}
              );
              if (isPromise(result)) {
                return result.then(res =>
                  deferred.resolve(skipJSON ? res : JSON.stringify(res))
                );
              }
              return deferred.resolve(
                skipJSON ? result : JSON.stringify(result)
              );
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
                return result.then(res =>
                  deferred.resolve(
                    skipJSON ? res : compiledQuery.stringify(res)
                  )
                );
              }
              return deferred.resolve(
                skipJSON ? result : compiledQuery.stringify(result)
              );
            }
          })
          // add listeners
          .on("cycle", (event: any) => {
            // tslint:disable-next-line
            console.log(String(event.target));
          })
          .on("start", () => {
            // tslint:disable-next-line
            console.log("Starting", bench);
          });
        return suite;
      }
    )
  );

  const benchsToRun = benchs.filter(isNotNull);
  let benchRunning = 1;
  benchsToRun.forEach(bench =>
    bench.on("complete", () => {
      if (benchRunning < benchsToRun.length) {
        benchsToRun[benchRunning++].run();
      }
    })
  );
  if (benchsToRun.length > 0) {
    benchsToRun[0].run();
  } else {
    // tslint:disable-next-line
    console.log("No benchmarks to run");
  }
}

// tslint:disable-next-line
runBenchmarks().catch(console.error);

function isNotNull<T>(a: T | null | undefined): a is T {
  return a != null;
}
