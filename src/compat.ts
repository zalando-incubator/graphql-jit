import {
  GraphQLSchema,
  GraphQLError,
  versionInfo,
  FieldNode,
  GraphQLField
} from "graphql";
import { GraphQLObjectType } from "graphql/type/definition";
import { Maybe } from "graphql/jsutils/Maybe";

import { ASTNode, OperationDefinitionNode } from "graphql/language/ast";
import * as utilities from "graphql/error";
import { GraphQLFormattedError } from "graphql/error";
import { CompilationContext } from "./execution";
import * as execute from "graphql/execution/execute";

/**
 * A helper file to support backward compatibility for different versions of graphql-js.
 */

/**
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
  schema: GraphQLSchema,
  operation: OperationDefinitionNode
): GraphQLObjectType {
  if (versionInfo.major < 16) {
    return (utilities as any).getOperationRootType(schema, operation);
  }

  const type = (schema as any).getRootType(operation.operation);

  if (!type) {
    throw new Error(`No root type for operation ${operation.operation}`);
  }

  return type;
}

/**
 * v16 and lower versions don't have .toJSON method on GraphQLError
 * v17 does have .toJSON and doesn't have "formatError" export anymore
 */
export function formatError(error: GraphQLError): GraphQLFormattedError {
  if (versionInfo.major < 16) {
    return (utilities as any).formatError(error);
  }

  return (error as any).toJSON();
}

/**
 * v17 dropped support for positional arguments in GraphQLError constructor
 * https://github.com/graphql/graphql-js/pull/3577
 */
export function getGraphQLErrorOptions(
  nodes: Maybe<ReadonlyArray<ASTNode> | ASTNode>
): ConstructorParameters<typeof GraphQLError>[1] {
  if (versionInfo.major < 16) {
    return nodes as any;
  }

  return { nodes } as any;
}

/**
 * Resolves the field on the given source object. In particular, this
 * figures out the value that the field returns by calling its resolve function,
 * then calls completeValue to complete promises, serialize scalars, or execute
 * the sub-selection-set for objects.
 *
 * v15 has getFieldDef that accepts field name
 * v16 has getFieldDef that accepts field node
 * v17 drops getFieldDef support and adds getField method
 */
export function resolveFieldDef(
  compilationContext: CompilationContext,
  parentType: GraphQLObjectType,
  fieldNodes: FieldNode[]
): Maybe<GraphQLField<any, any>> {
  const fieldNode = fieldNodes[0];

  if (versionInfo.major < 16) {
    const fieldName = fieldNode.name.value;
    return (execute as any).getFieldDef(
      compilationContext.schema,
      parentType,
      fieldName as any
    );
  }

  if (versionInfo.major < 17) {
    return (execute as any).getFieldDef(
      compilationContext.schema,
      parentType,
      fieldNode as any
    );
  }

  return (compilationContext.schema as any).getField(
    parentType,
    fieldNode.name.value
  );
}
