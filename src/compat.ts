import { GraphQLSchema, versionInfo } from "graphql";
import * as utilities from "graphql/utilities";
import { GraphQLObjectType } from "graphql/type/definition";
import { OperationDefinitionNode } from "graphql/language/ast";

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

export const getOperationRootType = (
  schema: GraphQLSchema,
  operation: OperationDefinitionNode
): GraphQLObjectType => {
  if (versionInfo.major < 16) {
    return (utilities as any).getOperationRootType(schema, operation);
  }

  const type = (schema as any).getRootType(operation.operation);

  if (!type) {
    throw new Error(`No root type for operation ${operation.operation}`);
  }

  return type;
};
