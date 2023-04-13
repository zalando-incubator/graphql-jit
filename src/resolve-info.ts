import genFn from "generate-function";
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
  isAbstractType,
  isCompositeType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
  Kind,
  SelectionSetNode
} from "graphql";
import memoize from "lodash.memoize";
import mergeWith from "lodash.mergewith";
import { memoize2, memoize4 } from "./memoize";
import { JitFieldNode } from "./ast";
import { CoercedVariableValues } from "./variables";

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
  fieldNodes: JitFieldNode[];
}

export type ShouldIncludeVariables = {
  variables: CoercedVariableValues;
};

export interface ShouldIncludeExtension {
  __shouldInclude: (variables: ShouldIncludeVariables) => boolean;
}

export type FieldExpansion = ShouldIncludeExtension & {
  // The possible return types that the field can return
  // It includes all the types in the Schema that intersect with the actual return type
  // eslint-disable-next-line no-use-before-define
  [returnType: string]: TypeExpansion;
};

type RootFieldExpansion = {
  // eslint-disable-next-line no-use-before-define
  [returnType: string]: TypeExpansion;
};

const LeafFieldSymbol = Symbol("LeafFieldSymbol");

export interface LeafField extends ShouldIncludeExtension {
  [LeafFieldSymbol]: true;
}

export interface TypeExpansion {
  // The fields that are requested in the Query for a particular type
  // `true` indicates a leaf node
  [fieldName: string]: FieldExpansion | LeafField;
}

function createLeafField<T extends object>(
  props: T,
  shouldInclude: (variables: ShouldIncludeVariables) => boolean
): T & LeafField {
  return {
    [LeafFieldSymbol]: true,
    __shouldInclude: shouldInclude,
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
  enricher?: (inp: ResolveInfoEnricherInput) => T
) {
  let enrichedInfo = {};
  if (typeof enricher === "function") {
    enrichedInfo =
      enricher({
        fieldName,
        fieldNodes,
        returnType: fieldType,
        parentType,
        schema,
        fragments,
        operation
      }) || {};
    if (typeof enrichedInfo !== "object" || Array.isArray(enrichedInfo)) {
      enrichedInfo = {};
    }
  }
  const gen = genFn();
  gen(`return function getGraphQLResolveInfo(rootValue, variableValues, path) {
      return {
          fieldName,
          fieldNodes,
          returnType: fieldType,
          parentType,
          path,
          schema,
          fragments,
          rootValue,
          operation,
          variableValues,`);
  Object.keys(enrichedInfo).forEach((key) => {
    gen(`${key}: enrichedInfo["${key}"],\n`);
  });
  gen(`};};`);
  // eslint-disable-next-line
  return new Function(
    "fieldName",
    "fieldNodes",
    "fieldType",
    "parentType",
    "schema",
    "fragments",
    "operation",
    "enrichedInfo",
    gen.toString()
  ).call(
    null,
    fieldName,
    fieldNodes,
    fieldType,
    parentType,
    schema,
    fragments,
    operation,
    enrichedInfo
  );
}

export function fieldExpansionEnricher(input: ResolveInfoEnricherInput) {
  const { schema, fragments, returnType, fieldNodes } = input;
  const fieldExpansion: RootFieldExpansion = {};

  for (const fieldNode of fieldNodes) {
    deepMerge(
      fieldExpansion,
      memoizedExpandFieldNode(schema, fragments, fieldNode, returnType)
    );
  }

  // this is remaining from deepMerge.
  // delete - because you can't skip resolution of root
  delete fieldExpansion.__shouldInclude;

  return {
    fieldExpansion
  };
}

type FragmentsType = GraphQLResolveInfo["fragments"];
type GraphQLNamedOutputType = GraphQLNamedType & GraphQLOutputType;
type GraphQLObjectLike = GraphQLInterfaceType | GraphQLObjectType;

const MEMOIZATION = true;

const memoizedGetReturnType = MEMOIZATION
  ? memoize2(getReturnType)
  : getReturnType;
const memoizedHasField = MEMOIZATION ? memoize2(hasField) : hasField;
const memoizedResolveEndType = MEMOIZATION
  ? memoize(resolveEndType)
  : resolveEndType;
const memoizedGetPossibleTypes = MEMOIZATION
  ? memoize2(getPossibleTypes)
  : getPossibleTypes;
const memoizedExpandFieldNodeType = MEMOIZATION
  ? memoize4(expandFieldNodeType)
  : expandFieldNodeType;
const memoizedExpandFieldNode = MEMOIZATION
  ? memoize4(expandFieldNode)
  : expandFieldNode;

function expandFieldNode(
  schema: GraphQLSchema,
  fragments: FragmentsType,
  node: JitFieldNode,
  fieldType: GraphQLOutputType
): FieldExpansion | LeafField {

  const shouldInclude = (variables: ShouldIncludeVariables): boolean => {

    const path = node.name.value;
    const rightKey = Object.keys(node.__internalShouldIncludePath as object).find((key) => {
      return key.split('.').pop() === path
    }) || path;

    if (node.__internalShouldIncludePath?.[rightKey]) {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`__context`, `return ${node.__internalShouldIncludePath[rightKey]}`)

      return fn(variables);
    } else {
      throw new Error(`No __internalShouldIncludePath found for ${path}`)
    }

  };

  if (node.selectionSet == null) {
    return createLeafField({}, shouldInclude);
  }

  // there is a selectionSet which makes the fieldType a CompositeType
  const typ = memoizedResolveEndType(fieldType) as GraphQLCompositeType;
  const possibleTypes = memoizedGetPossibleTypes(schema, typ);

  const fieldExpansion: FieldExpansion = Object.create(
    {
      __shouldInclude: shouldInclude
    },
    {}
  );
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
    if (selection.kind === Kind.FIELD) {
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
        selection.kind === Kind.INLINE_FRAGMENT
          ? selection.selectionSet
          : fragments[selection.name.value].selectionSet;

      const nextType =
        selection.kind === Kind.INLINE_FRAGMENT
          ? selection.typeCondition
            ? (schema.getType(
                selection.typeCondition.name.value
              ) as GraphQLCompositeType)
            : parentType
          : (schema.getType(
              fragments[selection.name.value].typeCondition.name.value
            ) as GraphQLCompositeType);

      /**
       * nextType (comes from query) is the type extracted from the fragment
       * parentType (comes from schema) is the possibleType for which we are filling fields
       *
       * if the type from query (nextType) is the same as the type we are filling (parentType)
       * or
       * if the type from query (nextType) is an abstract type - this case is when we jump
       * to a super type or sub type. Here we maintain the context (parentType) for which
       * we are filling the fields. The super type / sub type will be filled in its own
       * pass.
       */
      if (nextType === parentType || isAbstractType(nextType)) {
        deepMerge(
          typeExpansion,
          memoizedExpandFieldNodeType(
            schema,
            fragments,
            parentType,
            selectionSet
          )
        );
      }
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
  mergeWith(obj, src, (objValue, srcValue): LeafField | undefined => {
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

    return undefined;
  });
}
