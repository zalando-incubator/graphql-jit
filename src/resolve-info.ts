import {
  doTypesOverlap,
  FieldNode,
  GraphQLCompositeType,
  GraphQLError,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLSchema,
  isCompositeType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  SelectionNode,
  SelectionSetNode
} from "graphql";
import { ObjectPath } from "./ast";

export interface GraphQLJitResolveInfo extends GraphQLResolveInfo {
  fieldExpansion: FieldExpansion;
}

export interface FieldExpansion {
  // The possible return types that the field can return
  // It includes all the types in the Schema that intersect with the actual return type
  [returnType: string]: TypeExpansion;
}

export interface TypeExpansion {
  // The fields that are requested in the Query for a particular type
  // `true` indicates a leaf node
  [fieldName: string]: FieldExpansion | true;
}

/**
 * Compute the GraphQLJitResolveInfo's `fieldExpansion` and return a function
 * that returns the computed resolveInfo. This thunk is registered in
 * context.dependencies for the field's resolveInfoName
 */
export function createResolveInfoThunk({
  schema,
  fragments,
  operation,
  parentType,
  fieldName,
  fieldType,
  fieldNodes
}: {
  schema: GraphQLResolveInfo["schema"];
  fragments: GraphQLResolveInfo["fragments"];
  operation: GraphQLResolveInfo["operation"];
  parentType: GraphQLObjectType;
  fieldType: GraphQLOutputType;
  fieldName: string;
  fieldNodes: FieldNode[];
}) {
  const returnType = resolveEndType(fieldType);

  // Result
  const fieldExpansion: FieldExpansion = {};

  if (returnType != null) {
    for (const fieldNode of fieldNodes) {
      handleFieldNode(schema, fragments, returnType, fieldNode, fieldExpansion);
    }
  }

  return (
    rootValue: any,
    variableValues: any,
    path: ObjectPath
  ): GraphQLJitResolveInfo => ({
    fieldName,
    fieldNodes,
    returnType: fieldType,
    parentType,
    path,
    schema,
    fragments,
    rootValue,
    operation,
    variableValues,
    fieldExpansion
  });
}

type FragmentsType = GraphQLResolveInfo["fragments"];
type GraphQLNamedOutputType = GraphQLNamedType & GraphQLOutputType;

function handleSelectionSet(
  schema: GraphQLSchema,
  fragments: FragmentsType,
  possibleTypes: GraphQLCompositeType[],
  selectionSet: SelectionSetNode,
  fieldExpansion: FieldExpansion
) {
  for (const selection of selectionSet.selections) {
    handleSelection(
      schema,
      fragments,
      possibleTypes,
      selection,
      fieldExpansion
    );
  }
}

/**
 * Compute a list of possible Types from the returnType of the field and
 * build the TypeExpansion object for the Field. Pass it down to other
 * handlers to populate.
 */
function handleFieldNode(
  schema: GraphQLSchema,
  fragments: FragmentsType,
  returnType: GraphQLOutputType,
  node: FieldNode,
  fieldExpansion: FieldExpansion
) {
  if (node.selectionSet != null) {
    const resolvedType = resolveEndType(returnType);
    const possibleTypes = getPossibleTypes(
      schema,
      // if there is a selectionSet, the resolved type must be a composite type
      resolvedType as GraphQLCompositeType
    );

    for (const typ of possibleTypes) {
      if (!Object.prototype.hasOwnProperty.call(fieldExpansion, typ.name)) {
        fieldExpansion[typ.name] = {};
      }
    }

    handleSelectionSet(
      schema,
      fragments,
      possibleTypes,
      node.selectionSet,
      fieldExpansion
    );
  }
}

/**
 * Handle different kinds of selection nodes accordingly.
 *
 * For a field, add the field to the TypeExpansion. Create and link
 * the next FieldExpansion object to be handled recursively
 *
 */
function handleSelection(
  schema: GraphQLSchema,
  fragments: FragmentsType,
  possibleTypes: GraphQLCompositeType[],
  node: SelectionNode,
  fieldExpansion: FieldExpansion
) {
  switch (node.kind) {
    case "Field":
      if (node.selectionSet != null) {
        const returnType = getReturnType(possibleTypes[0], node.name.value);
        const nextFieldExpansion: FieldExpansion = {};
        handleFieldNode(
          schema,
          fragments,
          returnType,
          node,
          nextFieldExpansion
        );
        for (const typ of possibleTypes) {
          fieldExpansion[typ.name][node.name.value] = nextFieldExpansion;
        }
      } else {
        for (const typ of possibleTypes) {
          fieldExpansion[typ.name][node.name.value] = true;
        }
      }
      break;

    case "InlineFragment":
      {
        let nextPossibleTypes = possibleTypes;
        if (node.typeCondition != null) {
          const typeConditionType = schema.getType(
            node.typeCondition.name.value
          );
          if (typeConditionType == null) {
            throw new GraphQLError(
              `Invalid InlineFragment: Type "${
                node.typeCondition.name.value
              }" does not exist in schema.`
            );
          }
          // here we are inside a fragment and it's possible only for Composite Types
          nextPossibleTypes = [typeConditionType as GraphQLCompositeType];
        }

        handleSelectionSet(
          schema,
          fragments,
          nextPossibleTypes,
          node.selectionSet,
          fieldExpansion
        );
      }
      break;

    case "FragmentSpread":
      {
        const fragment = fragments[node.name.value];
        const typeConditionType = schema.getType(
          fragment.typeCondition.name.value
        );
        if (typeConditionType == null) {
          throw new GraphQLError(
            `Invalid Fragment: Type "${
              fragment.typeCondition.name.value
            }" does not exist in schema.`
          );
        }

        handleSelectionSet(
          schema,
          fragments,
          [typeConditionType as GraphQLCompositeType],
          fragment.selectionSet,
          fieldExpansion
        );
      }
      break;
  }
}

/**
 * Given an (Object|Interface)Type, and a fieldName, find the
 * appropriate `end` return type for the field in the Composite Type.
 *
 * Note: The `end` return type is the type by unwrapping non-null types
 * and list types. Check `resolveEndType`
 */
function getReturnType(
  parentType: GraphQLCompositeType,
  fieldName: string
): GraphQLNamedOutputType {
  if (!(isInterfaceType(parentType) || isObjectType(parentType))) {
    throw new GraphQLError(
      `Invalid selection: Field "${fieldName}" for type "${parentType.name}"`
    );
  }

  const fields = parentType.getFields();
  if (!Object.prototype.hasOwnProperty.call(fields, fieldName)) {
    throw new GraphQLError(
      `Field "${fieldName}" does not exist in "${parentType.name}"`
    );
  }

  const outputType = fields[fieldName].type;
  return resolveEndType(outputType);
}

/**
 * Returns a list of Possible types that one can get to from the
 * resolvedType. As an analogy, these are the same types that one
 * can use in a fragment's typeCondition.
 *
 * Note: This is different from schema.getPossibleTypes() that this
 * returns all possible types and not just the ones from the type definition.
 *
 * Example:
 * interface Node {
 *   id: ID!
 * }
 * type User implements Node {
 *   id: ID!
 *   name: String
 * }
 * type Article implements Node {
 *   id: ID!
 *   title: String
 * }
 * union Card = User | Article
 *
 * - schema.getPossibleTypes(Card) would give [User, Article]
 * - This function getPossibleTypes(schema, Card) would give [User, Article, Node]
 *
 */
function getPossibleTypes(
  schema: GraphQLSchema,
  resolvedType: GraphQLCompositeType
): GraphQLCompositeType[] {
  if (isObjectType(resolvedType)) {
    return [resolvedType];
  }

  const possibleTypes: GraphQLCompositeType[] = [];
  const types = schema.getTypeMap();
  for (const typeName in types) {
    if (Object.prototype.hasOwnProperty.call(types, typeName)) {
      const typ = types[typeName];
      if (isCompositeType(typ) && doTypesOverlap(schema, typ, resolvedType)) {
        possibleTypes.push(typ);
      }
    }
  }

  return possibleTypes;
}

/**
 * Resolve to the end type of the Output type unwrapping non-null types and lists
 */
function resolveEndType(typ: GraphQLOutputType): GraphQLNamedOutputType {
  if (isListType(typ) || isNonNullType(typ)) {
    return resolveEndType(typ.ofType);
  }
  return typ;
}
