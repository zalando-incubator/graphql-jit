import * as graphql from "graphql";
import {
  GraphQLSchema,
  GraphQLError,
  versionInfo,
  type FieldNode,
  type GraphQLField,
  type ASTNode,
  type OperationDefinitionNode,
  type GraphQLObjectType,
  type GraphQLFormattedError,
  type ConstValueNode,
  GraphQLScalarType,
  SchemaMetaFieldDef,
  TypeMetaFieldDef,
  TypeNameMetaFieldDef
} from "graphql";
import { type Maybe } from "./types.js";
import { type CompilationContext } from "./execution.js";

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
    return (graphql as any).getOperationRootType(schema, operation);
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
    return (graphql as any).formatError(error);
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
 */
export function resolveFieldDef(
  compilationContext: CompilationContext,
  parentType: GraphQLObjectType,
  fieldNodes: FieldNode[]
): Maybe<GraphQLField<any, any>> {
  const fieldNode = fieldNodes[0];
  const fieldName = fieldNode.name.value;

  if (versionInfo.major < 17) {
    const schema = compilationContext.schema;
    if (
      fieldName === SchemaMetaFieldDef.name &&
      schema.getQueryType() === parentType
    ) {
      return SchemaMetaFieldDef;
    }
    if (
      fieldName === TypeMetaFieldDef.name &&
      schema.getQueryType() === parentType
    ) {
      return TypeMetaFieldDef;
    }
    if (fieldName === TypeNameMetaFieldDef.name) {
      return TypeNameMetaFieldDef;
    }
    return parentType.getFields()[fieldName];
  }

  return (compilationContext.schema as any).getField(parentType, fieldName);
}

/**
 * v17 introduces `arg.default = { value }` for SDL-built schemas.
 * Programmatic schemas still use `arg.defaultValue`.
 * This helper normalizes both to a single value.
 */
export function getDefaultValue(argOrField: {
  defaultValue?: unknown;
  default?: { value?: unknown; literal?: unknown };
}): unknown {
  if (argOrField.default !== undefined) {
    // v17 SDL-built default — `.value` holds the JS value
    return (argOrField.default as any).value;
  }
  return argOrField.defaultValue;
}

export function hasDefaultValue(argOrField: {
  defaultValue?: unknown;
  default?: { value?: unknown; literal?: unknown };
}): boolean {
  return (
    argOrField.default !== undefined || argOrField.defaultValue !== undefined
  );
}

/**
 * v17 deprecates parseLiteral in favor of coerceInputLiteral for custom scalars
 * However, custom scalars may still only define parseLiteral, so we check
 * for the method's existence rather than just the version.
 */
export function coerceInputLiteral(
  type: GraphQLScalarType<unknown, unknown>,
  valueNode: ConstValueNode
): any {
  // Use coerceInputLiteral if available (built-in scalars in v17+)
  // Otherwise fall back to parseLiteral (custom scalars, or v16)
  if ((type as any).coerceInputLiteral) {
    return (type as any).coerceInputLiteral(valueNode);
  }

  return (type as any).parseLiteral(valueNode, {});
}

/**
 * V17 removes execution context
 * This is a minimal interface to support the execution context for v16 and v17+
 */
export interface ExecutionContext {
  errors: Array<GraphQLError> | undefined;
  completed: boolean;
  errorPropagation: boolean;
}
