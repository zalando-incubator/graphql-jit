import { GraphQLExecutor } from "apollo-server-core";
import { GraphQLSchema } from "graphql";
import LRU from "tiny-lru";
import {
  CompiledQuery,
  compileQuery,
  CompilerOptions,
  isCompiledQuery
} from "../../../";

export const executor = (
  schema: GraphQLSchema,
  cacheSize = 1024,
  compilerOpts: Partial<CompilerOptions> = {}
): GraphQLExecutor => {
  const cache = LRU<CompiledQuery>(cacheSize);
  return async ({ context, document, operationName, request, queryHash }) => {
    const prefix = operationName || "NotParametrized";
    const cacheKey = `${prefix}-${queryHash}`;
    let compiledQuery = cache.get(cacheKey);
    if (!compiledQuery) {
      const compilationResult = compileQuery(schema, document, operationName || undefined, compilerOpts);
      if (isCompiledQuery(compilationResult)) {
        compiledQuery = compilationResult;
        cache.set(cacheKey, compiledQuery);
      } else {
        // ...is ExecutionResult
        return compilationResult;
      }
    }
    return compiledQuery.query(undefined, context, request.variables || {});
  };
};
