import {
  doTypesOverlap,
  FieldNode,
  GraphQLCompositeType,
  GraphQLError,
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLSchema,
  isCompositeType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
  SelectionSetNode
} from "graphql";
import memoize from "lodash.memoize";
import mergeWith from "lodash.mergewith";
import { ObjectPath } from "./ast";
import { memoize2, memoize4 } from "./memoize";

// TODO(boopathi): Use negated types to express
// Enrichments<T> = { [key in (string & not keyof GraphQLResolveInfo)]: T[key] }
// in TypeScript 3.5
// https://github.com/Microsoft/TypeScript/pull/29317
export type GraphQLJitResolveInfo<Enrichments> = GraphQLResolveInfo &
  Enrichments;

export interface ResolveInfoEnricherInput {
  schema: GraphQLResolveInfo["schema"];
  fragments: GraphQLResolveInfo["fragments"];
  operation: GraphQLResolveInfo["operation"];
  parentType: GraphQLObjectType;
  returnType: GraphQLOutputType;
  fieldName: string;
  fieldNodes: FieldNode[];
}

export interface FieldExpansion {
  // The possible return types that the field can return
  // It includes all the types in the Schema that intersect with the actual return type
  [returnType: string]: TypeExpansion;
}

export interface TypeExpansion {
  // The fields that are requested in the Query for a particular type
  // `true` indicates a leaf node
  [fieldName: string]: FieldExpansion | LeafField;
}

const LeafFieldSymbol = Symbol("LeafFieldSymbol");

export interface LeafField {
  [LeafFieldSymbol]: true;
}

function createLeafField<T extends object>(props: T): T & LeafField {
  return {
    [LeafFieldSymbol]: true,
    ...props
  };
}

export function isLeafField(obj: LeafField | FieldExpansion): obj is LeafField {
  return (
    obj != null && Object.prototype.hasOwnProperty.call(obj, LeafFieldSymbol)
  );
}

/**
 * Compute the GraphQLJitResolveInfo's `fieldExpansion` and return a function
 * that returns the computed resolveInfo. This thunk is registered in
 * context.dependencies for the field's resolveInfoName
 */
export function createResolveInfoThunk<T>(
  {
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
  },
  enricher: (inp: ResolveInfoEnricherInput) => T = () => ({} as T)
) {
  const enricherInput = {
    fieldName,
    fieldNodes,
    returnType: fieldType,
    parentType,
    schema,
    fragments,
    operation
  };

  const enrichedInfo = {
    ...enricherInput,
    ...enricher(enricherInput)
  };

  return (
    rootValue: any,
    variableValues: any,
    path: ObjectPath
  ): GraphQLJitResolveInfo<T> => ({
    rootValue,
    variableValues,
    path,
    ...enrichedInfo
  });
}

export function fieldExpansionEnricher(input: ResolveInfoEnricherInput) {
  const { schema, fragments, returnType, fieldNodes } = input;
  const fieldExpansion: FieldExpansion | LeafField = {};

  for (const fieldNode of fieldNodes) {
    deepMerge(
      fieldExpansion,
      memoizedExpandFieldNode(schema, fragments, fieldNode, returnType)
    );
  }

  return {
    fieldExpansion
  };
}

type FragmentsType = GraphQLResolveInfo["fragments"];
type GraphQLNamedOutputType = GraphQLNamedType & GraphQLOutputType;
type GraphQLObjectLike = GraphQLInterfaceType | GraphQLObjectType;

const memoizedGetReturnType = memoize2(getReturnType);
const memoizedHasField = memoize2(hasField);
const memoizedResolveEndType = memoize(resolveEndType);
const memoizedGetPossibleTypes = memoize2(getPossibleTypes);
const memoizedExpandFieldNodeType = memoize4(expandFieldNodeType);
const memoizedExpandFieldNode = memoize4(expandFieldNode);

function expandFieldNode(
  schema: GraphQLSchema,
  fragments: FragmentsType,
  node: FieldNode,
  fieldType: GraphQLOutputType
): FieldExpansion | LeafField {
  if (node.selectionSet == null) {
    return createLeafField({});
  }

  // there is a selectionSet which makes the fieldType a CompositeType
  const typ = memoizedResolveEndType(fieldType) as GraphQLCompositeType;
  const possibleTypes = memoizedGetPossibleTypes(schema, typ);

  const fieldExpansion: FieldExpansion = {};
  for (const possibleType of possibleTypes) {
    if (!isUnionType(possibleType)) {
      fieldExpansion[possibleType.name] = memoizedExpandFieldNodeType(
        schema,
        fragments,
        possibleType,
        node.selectionSet
      );
    }
  }

  return fieldExpansion;
}

function expandFieldNodeType(
  schema: GraphQLSchema,
  fragments: FragmentsType,
  parentType: GraphQLCompositeType,
  selectionSet: SelectionSetNode
): TypeExpansion {
  const typeExpansion: TypeExpansion = {};

  for (const selection of selectionSet.selections) {
    if (selection.kind === "Field") {
      if (
        !isUnionType(parentType) &&
        memoizedHasField(parentType, selection.name.value)
      ) {
        typeExpansion[selection.name.value] = memoizedExpandFieldNode(
          schema,
          fragments,
          selection,
          memoizedGetReturnType(parentType, selection.name.value)
        );
      }
    } else {
      const selectionSet =
        selection.kind === "InlineFragment"
          ? selection.selectionSet
          : fragments[selection.name.value].selectionSet;
      deepMerge(
        typeExpansion,
        memoizedExpandFieldNodeType(schema, fragments, parentType, selectionSet)
      );
    }
  }

  return typeExpansion;
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
  compositeType: GraphQLCompositeType
) {
  if (isObjectType(compositeType)) {
    return [compositeType];
  }

  const possibleTypes: GraphQLCompositeType[] = [];
  const types = schema.getTypeMap();
  for (const typeName in types) {
    if (Object.prototype.hasOwnProperty.call(types, typeName)) {
      const typ = types[typeName];
      if (isCompositeType(typ) && doTypesOverlap(schema, typ, compositeType)) {
        possibleTypes.push(typ);
      }
    }
  }

  return possibleTypes;
}

/**
 * Given an (Object|Interface)Type, and a fieldName, find the
 * appropriate `end` return type for the field in the Composite Type.
 *
 * Note: The `end` return type is the type by unwrapping non-null types
 * and list types. Check `resolveEndType`
 */
function getReturnType(
  parentType: GraphQLObjectLike,
  fieldName: string
): GraphQLNamedOutputType {
  const fields = parentType.getFields();
  if (!Object.prototype.hasOwnProperty.call(fields, fieldName)) {
    throw new GraphQLError(
      `Field "${fieldName}" does not exist in "${parentType.name}"`
    );
  }

  const outputType = fields[fieldName].type;
  return memoizedResolveEndType(outputType);
}

/**
 * Resolve to the end type of the Output type unwrapping non-null types and lists
 */
function resolveEndType(typ: GraphQLOutputType): GraphQLNamedOutputType {
  if (isListType(typ) || isNonNullType(typ)) {
    return memoizedResolveEndType(typ.ofType);
  }
  return typ;
}

function hasField(typ: GraphQLObjectLike, fieldName: string) {
  return Object.prototype.hasOwnProperty.call(typ.getFields(), fieldName);
}

// This is because lodash does not support merging keys
// which are symbols. We require them for leaf fields
function deepMerge<TObject, TSource>(obj: TObject, src: TSource) {
  mergeWith(obj, src, (objValue, srcValue) => {
    if (isLeafField(objValue)) {
      if (isLeafField(srcValue)) {
        return {
          ...objValue,
          ...srcValue
        };
      }

      return objValue;
    } else if (isLeafField(srcValue)) {
      return srcValue;
    }

    return;
  });
}
