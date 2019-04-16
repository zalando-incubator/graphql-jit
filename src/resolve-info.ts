import {
  GraphQLResolveInfo,
  FieldNode,
  SelectionSetNode,
  SelectionNode,
  GraphQLObjectType,
  GraphQLOutputType,
  isScalarType,
  isListType,
  GraphQLList,
  GraphQLType,
  isTypeSubTypeOf,
  GraphQLSchema
} from "graphql";
import { ObjectPath } from "./ast";

export interface GraphQLJitResolveInfo extends GraphQLResolveInfo {
  /**
   * A list of field names requested at the current Object/List type
   * It is null for leaf nodes. This is rather useful for lookaheads
   * to construct the query to the backend in the resolver
   */
  fields: {
    [returnType: string]: string[];
  };
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
  let fields: GraphQLJitResolveInfo["fields"] = {};
  const returnType = getEndReturnType(fieldType);

  if (returnType != null) {
    const selections = getAllSelectionFieldNodes(
      schema,
      fieldNodes,
      returnType,
      fragments
    );
    for (let fieldType in selections) {
      if (Object.prototype.hasOwnProperty.call(selections, fieldType)) {
        // Get unique names of fields from the fieldNodes list for
        // each return Type
        const selectionFields: Set<string> = new Set(
          selections[fieldType].map(fieldNode => fieldNode.name.value)
        );

        fields[fieldType] = [...selectionFields];
      }
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
    fields
  });
}

function getEndReturnType(fieldType: GraphQLOutputType): string | undefined {
  if (isScalarType(fieldType)) {
    return;
  }
  if (isListType(fieldType)) {
    return getEndReturnType(fieldType.ofType);
  }
  return fieldType.name;
}

type FieldNodesType = GraphQLResolveInfo["fieldNodes"];
type FragmentsType = GraphQLResolveInfo["fragments"];

interface SelectionFieldsCollector {
  [fieldType: string]: FieldNode[];
}

function collectorSet(
  collector: SelectionFieldsCollector,
  fieldType: string,
  fieldNode: FieldNode
) {
  if (!Object.prototype.hasOwnProperty.call(collector, fieldType)) {
    collector[fieldType] = [];
  }
  collector[fieldType].push(fieldNode);
}

/**
 * Computes the list of selections for the current field by upwrapping
 * Inline fragments and Fragments
 */
function getAllSelectionFieldNodes(
  schema: GraphQLSchema,
  fieldNodes: FieldNodesType,
  defaultReturnType: string,
  fragments: FragmentsType
) {
  const collector: SelectionFieldsCollector = {};

  for (const fieldNode of fieldNodes) {
    if (fieldNode.selectionSet) {
      handleSelectionSet(
        fragments,
        defaultReturnType,
        fieldNode.selectionSet,
        collector
      );
    }
  }

  // normalize the fields and duplicate it to all sub-types
  const fieldTypes = Object.keys(collector);
  for (let i = 0; i < fieldTypes.length; i++) {
    for (let j = i + 1; j < fieldTypes.length; j++) {
      const iType = schema.getType(fieldTypes[i]);
      const jType = schema.getType(fieldTypes[j]);
      if (iType && jType) {
        if (isTypeSubTypeOf(schema, iType, jType)) {
          collector[fieldTypes[i]].push(...collector[fieldTypes[j]]);
        } else if (isTypeSubTypeOf(schema, jType, iType)) {
          collector[fieldTypes[j]].push(...collector[fieldTypes[i]]);
        }
      }
    }
  }

  return collector;
}

function handleSelectionSet(
  fragments: FragmentsType,
  returnType: string,
  selectionSet: SelectionSetNode,
  collector: SelectionFieldsCollector
) {
  for (const selection of selectionSet.selections) {
    handleSelection(fragments, returnType, selection, collector);
  }
}

function handleSelection(
  fragments: FragmentsType,
  returnType: string,
  node: SelectionNode,
  collector: SelectionFieldsCollector
) {
  switch (node.kind) {
    case "Field":
      collectorSet(collector, returnType, node);
      break;

    case "InlineFragment":
      if (node.typeCondition == null) {
        throw new Error(`TypeCondition is undefined for ${node}`);
      }
      handleSelectionSet(
        fragments,
        node.typeCondition.name.value,
        node.selectionSet,
        collector
      );
      break;

    case "FragmentSpread":
      const fragment = fragments[node.name.value];
      handleSelectionSet(
        fragments,
        fragment.typeCondition.name.value,
        fragment.selectionSet,
        collector
      );
      break;
  }
}
