import {
  ExecutionResult,
  FieldNode,
  getOperationRootType,
  GraphQLError,
  GraphQLType,
  isListType,
  isNonNullType,
  isObjectType
} from "graphql";
import { ExecutionContext } from "graphql/execution/execute";
import { isAbstractType } from "graphql/type";
import merge from "lodash.merge";
import { collectFields, collectSubfields, resolveFieldDef } from "./ast";

interface QueryMetadata {
  isNullable: boolean;
  children: { [key: string]: QueryMetadata };
}

export type NullTrimmer = (data: any, errors: GraphQLError[]) => any;

/**
 *
 * @param {ExecutionContext} exeContext
 * @returns {(data: any, errors: GraphQLError[]) => {data: any; errors: GraphQLError[]}}
 */
export function createNullTrimmer(exeContext: ExecutionContext): NullTrimmer {
  return trimData(parseQueryNullables(exeContext));
}

/**
 * Trims a data response according to the field erros in non null fields.
 *
 * Errors are filtered to ensure a single field error per field.
 *
 * @param {QueryMetadata} nullable Description of the query and their nullability
 * @returns {(data: any, errors: GraphQLError[]) => {data: any; errors: GraphQLError[]}}
 * the trimmed data and a filtered list of errors.
 */
function trimData(nullable: QueryMetadata): NullTrimmer {
  return (data: any, errors: GraphQLError[]): ExecutionResult => {
    const finalErrors = [];
    const processedErrors = new Set<string>();
    for (const error of errors) {
      if (!error.path) {
        // should never happen, it is a bug if it does
        throw new Error("no path available for tree trimming");
      }
      if (processedErrors.has(error.path.join("."))) {
        // there can be multiple field errors in some scenario
        // there is no need to continue processing and it should not be part of the final response
        continue;
      }
      const ancestors = findNullableAncestor(nullable, error.path);
      // The top level field is always nullable
      // http://facebook.github.io/graphql/June2018/#sec-Errors-and-Non-Nullability
      //
      // There is no mention if the following errors need to be present in the response.
      // For now we assume this is not needed.
      if (ancestors.length === 0) {
        data = null;
        finalErrors.push(error);
        break;
      }
      removeBranch(data, ancestors);
      processedErrors.add(error.path.join("."));
      finalErrors.push(error);
    }
    return { data, errors: finalErrors };
  };
}

/**
 * Removes a branch out of the response data by mutating the original object.
 *
 * @param tree response data
 * @param {Array<number | string>} branch array with the path that should be trimmed
 */
function removeBranch(tree: any, branch: Array<number | string>): void {
  for (let i = 0; i < branch.length - 1; ++i) {
    tree = tree[branch[i]];
  }
  const toNull = branch[branch.length - 1];
  tree[toNull] = null;
}

/**
 * Name of the child used in array to contain the description.
 *
 * Only used for list to contain the child description.
 */
const ARRAY_CHILD_NAME = "index";

/**
 *
 * @param {QueryMetadata} nullable Description of the query and their nullability
 * @param {ReadonlyArray<string | number>} paths path of the error location
 * @returns {Array<string | number>} path of the branch to be made null
 */
function findNullableAncestor(
  nullable: QueryMetadata,
  paths: ReadonlyArray<string | number>
): Array<string | number> {
  let lastNullable = 0;
  for (let i = 0; i < paths.length; ++i) {
    const path = paths[i];
    const child =
      nullable.children[typeof path === "string" ? path : ARRAY_CHILD_NAME];
    if (!child) {
      // Stopping the search since we reached a leaf node,
      // the loop should be on its final iteration
      break;
    }
    if (child.isNullable) {
      lastNullable = i + 1;
    }
    nullable = child;
  }
  return paths.slice(0, lastNullable);
}

/**
 * Produce a description of the query regarding its nullability.
 *
 * Leaf nodes are not present in this representation since they are not
 * interesting for removing branches of the response tree.
 *
 * The structure is recursive like the query.
 * @param {ExecutionContext} exeContext Execution content
 * @returns {QueryMetadata} description of the query
 */
function parseQueryNullables(exeContext: ExecutionContext): QueryMetadata {
  const type = getOperationRootType(exeContext.schema, exeContext.operation);
  const fields = collectFields(
    exeContext,
    type,
    exeContext.operation.selectionSet,
    Object.create(null)
  );
  const properties = Object.create(null);
  for (const responseName of Object.keys(fields)) {
    const fieldType = resolveFieldDef(exeContext, type, fields[responseName]);
    if (!fieldType) {
      // if field does not exist, it should be ignored for compatibility concerns.
      // Usually, validation would stop it before getting here but this could be an old query
      continue;
    }
    const property = transformNode(
      exeContext,
      fields[responseName],
      fieldType.type
    );
    if (property != null) {
      properties[responseName] = property;
    }
  }
  return {
    isNullable: true,
    children: properties
  };
}

/**
 * Processes a single node to produce a description of itself and its children.
 *
 * Leaf nodes are ignore and removed from the description
 * @param {ExecutionContext} exeContext
 * @param {FieldNode[]} fieldNodes list of fields
 * @param {GraphQLType} type Current type being processed.
 * @returns {QueryMetadata | null} null if node is a leaf, otherwise a desciption of the node and its children.
 */
function transformNode(
  exeContext: ExecutionContext,
  fieldNodes: FieldNode[],
  type: GraphQLType
): QueryMetadata | null {
  if (isNonNullType(type)) {
    const nullable = transformNode(exeContext, fieldNodes, type.ofType);
    if (nullable != null) {
      nullable.isNullable = false;
      return nullable;
    }
    return null;
  }
  if (isObjectType(type)) {
    const subfields = collectSubfields(exeContext, type, fieldNodes);
    const properties = Object.create(null);
    for (const responseName of Object.keys(subfields)) {
      const fieldType = resolveFieldDef(
        exeContext,
        type,
        subfields[responseName]
      );
      if (!fieldType) {
        // if field does not exist, it should be ignored for compatibility concerns.
        // Usually, validation would stop it before getting here but this could be an old query
        continue;
      }
      const property = transformNode(
        exeContext,
        subfields[responseName],
        fieldType.type
      );
      if (property != null) {
        properties[responseName] = property;
      }
    }
    return {
      isNullable: true,
      children: properties
    };
  }
  if (isListType(type)) {
    const child = transformNode(exeContext, fieldNodes, type.ofType);
    if (child != null) {
      return {
        isNullable: true,
        children: { [ARRAY_CHILD_NAME]: child }
      };
    }

    return {
      isNullable: true,
      children: {}
    };
  }
  if (isAbstractType(type)) {
    return exeContext.schema.getPossibleTypes(type).reduce(
      (res, t) => {
        const property = transformNode(exeContext, fieldNodes, t);
        if (property != null) {
          // We do a deep merge because children can have subset of properties
          // TODO: Possible bug: two object with different nullability on objects.
          res.children = merge(res.children, property.children);
        }
        return res;
      },
      {
        isNullable: true,
        children: {}
      }
    );
  }

  // Scalars and enum are ignored since they are leaf values
  return null;
}
