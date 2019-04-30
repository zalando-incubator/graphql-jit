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
  GraphQLType,
  isCompositeType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isOutputType,
  SelectionNode,
  SelectionSetNode
} from "graphql";
import { ObjectPath } from "./ast";

export interface GraphQLJitResolveInfo extends GraphQLResolveInfo {
  fieldExpansion: FieldExpansion;
}

export interface FieldExpansion {
  [returnType: string]: TypeExpansion;
}

export interface TypeExpansion {
  [fieldName: string]: FieldExpansion | true;
}

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
        const returnType = getReturnType(
          schema,
          possibleTypes[0],
          node.name.value
        );
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

function getReturnType(
  schema: GraphQLSchema,
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
      `Field "${fieldName}" does not exist in "${parentType}"`
    );
  }

  const outputType = fields[fieldName].type;
  return resolveEndType(outputType);
}

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

function resolveEndType(typ: GraphQLOutputType): GraphQLNamedOutputType {
  if (isListType(typ) || isNonNullType(typ)) {
    return resolveEndType(typ.ofType);
  }
  return typ;
}
