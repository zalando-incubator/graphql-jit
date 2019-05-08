import { CompiledQuery, compileQuery, isCompiledQuery } from "../../../";
import { GraphQLSchema, validate, parse, GraphQLError } from "graphql";
import { createHash } from "crypto";

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
  constructor(private schema: GraphQLSchema) {}

  get(id: string): CompiledQuery | undefined {
    return this.store.get(id);
  }

  add(query: string): string {
    const validationErrors = validate(this.schema, parse(query));
    if (validationErrors.length > 0) {
      throw new ValidationError(validationErrors);
    }

    const compiledQuery = compileQuery(this.schema, parse(query));
    if (!isCompiledQuery(compiledQuery)) {
      throw new ValidationError(compiledQuery.errors!);
    }

    const id = this.getId(query);
    this.store.set(id, compiledQuery);
    return id;
  }

  private getId(query: string): string {
    const hash = createHash("sha256");
    hash.update(query);
    return hash.digest("hex");
  }
}
