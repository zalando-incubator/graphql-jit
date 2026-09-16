import { CompiledQuery, compileQuery, isCompiledQuery } from "../../../";
import { GraphQLSchema, validate, parse, GraphQLError } from "graphql";
import { createHash } from "node:crypto";
import { format } from "@prettier/sync";

class ValidationError extends Error {
  constructor(public errors: ReadonlyArray<GraphQLError>) {
    super("INVALID QUERY: " + JSON.stringify(errors));
  }
}

/**
 * A Store of Compiled Queries that are accessible via the QueryID
 */
export default class QueryStore {
  private store = new Map<string, CompiledQuery>();
  // eslint-disable-next-line no-useless-constructor
  constructor(private schema: GraphQLSchema) {}

  get(id: string): CompiledQuery | undefined {
    return this.store.get(id);
  }

  add(query: string): string {
    const id = this.getId(query);
    const document = parse(query);
    const validationErrors = validate(this.schema, document);
    if (validationErrors.length > 0) {
      throw new ValidationError(validationErrors);
    }

    const compiledQuery = compileQuery(this.schema, document, undefined, {
      debug: {
        enabled: true,
        querySourceName: `graphql-jit://graphql-jit/blog/${id}.query.js`,
        variablesSourceName: `graphql-jit://graphql-jit/blog/${id}.variables.js`,
        formatSourceCode: (source) => format(source, { parser: "babel" })
      }
    });
    if (!isCompiledQuery(compiledQuery)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      throw new ValidationError(compiledQuery.errors!);
    }

    this.store.set(id, compiledQuery);
    return id;
  }

  private getId(query: string): string {
    const hash = createHash("sha256");
    hash.update(query);
    return hash.digest("hex");
  }
}
