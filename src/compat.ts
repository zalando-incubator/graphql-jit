import * as GraphQL from "graphql";

/**
 * A helper to support backward compatibility for different versions of graphql-js.
 *
 * v15 does not have schema.getRootType
 * v16 has both
 * v17 will not have getOperationRootType
 *
 * To support all these 3 versions of graphql-js, at least for migration, this helper
 * would be useful.
 *
 * This can be removed once we drop support for v15.
 *
 * GraphQL v17 would remove getOperationRootType.
 */
export function getOperationRootType(
  schema: GraphQL.GraphQLSchema,
  operation: GraphQL.OperationDefinitionNode
) {
  if (GraphQL.getOperationRootType) {
    return GraphQL.getOperationRootType(schema, operation);
  } else {
    return schema.getRootType(operation.operation)!;
  }
}
