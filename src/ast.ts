import {
  type ArgumentNode,
  type ASTNode,
  type DirectiveNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLArgument,
  GraphQLDirective,
  GraphQLError,
  type GraphQLField,
  type GraphQLInputType,
  GraphQLObjectType,
  type InlineFragmentNode,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isScalarType,
  print,
  type SelectionSetNode,
  type SourceLocation,
  typeFromAST,
  type ValueNode,
  type VariableNode,
  Kind,
  type SelectionNode,
  isAbstractType,
  Location,
  type ConstValueNode
} from "graphql";
import { type CompilationContext } from "./execution.js";
import createInspect from "./inspect.js";
import {
  coerceInputLiteral,
  getDefaultValue,
  getGraphQLErrorOptions,
  hasDefaultValue,
  resolveFieldDef
} from "./compat.js";
import {
  addFragmentShouldIncludeBranch,
  ALWAYS_INCLUDE,
  andShouldInclude,
  compileSkipInclude,
  createFragmentShouldInclude,
  getFieldNodeShouldInclude,
  type OrNode,
  setFieldNodeShouldInclude,
  type ShouldInclude
} from "./skip-include.js";

export interface FieldsAndNodes {
  [key: string]: FieldNode[];
}

const inspect = createInspect();

/**
 * Given a selectionSet, adds all of the fields in that selection to
 * the passed in map of fields, and returns it at the end.
 *
 * CollectFields requires the "runtime type" of an object. For a field which
 * returns an Interface or Union type, the "runtime type" will be the actual
 * Object type returned by that field.
 *
 * As skip/include directives can only be evaluated at runtime,
 * the condition under which each collected field node is included
 * is recorded with it; see `compileFieldNodesShouldInclude`.
 */
export function collectFields(
  compilationContext: CompilationContext,
  runtimeType: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  fields: FieldsAndNodes,
  visitedFragmentNames: { [key: string]: OrNode }
): FieldsAndNodes {
  return collectFieldsImpl(
    compilationContext,
    runtimeType,
    selectionSet,
    fields,
    visitedFragmentNames,
    ALWAYS_INCLUDE
  );
}

/**
 * Implementation of collectFields defined above with extra parameters
 * used for recursion and need not be exposed publically
 */
function collectFieldsImpl(
  compilationContext: CompilationContext,
  runtimeType: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  fields: FieldsAndNodes,
  visitedFragmentNames: { [key: string]: OrNode },
  parentShouldInclude: ShouldInclude
): FieldsAndNodes {
  interface StackItem {
    selection: SelectionNode;
    shouldInclude: ShouldInclude;
  }

  const stack: StackItem[] = [];

  const pushSelections = (
    selections: readonly SelectionNode[],
    shouldInclude: ShouldInclude
  ) => {
    // Push in reverse so that stack.pop() will process in document order
    for (let i = selections.length - 1; i >= 0; i--) {
      stack.push({ selection: selections[i], shouldInclude });
    }
  };

  pushSelections(selectionSet.selections, parentShouldInclude);

  while (stack.length > 0) {
    const { selection, shouldInclude } = stack.pop()!;

    switch (selection.kind) {
      case Kind.FIELD: {
        addFieldNode(
          fields,
          selection,
          andShouldInclude(
            shouldInclude,
            compileSkipInclude(compilationContext, selection)
          )
        );
        break;
      }

      case Kind.INLINE_FRAGMENT: {
        if (
          !doesFragmentConditionMatch(
            compilationContext,
            selection,
            runtimeType
          )
        ) {
          break;
        }

        pushSelections(
          selection.selectionSet.selections,
          andShouldInclude(
            shouldInclude,
            compileSkipInclude(compilationContext, selection)
          )
        );
        break;
      }

      case Kind.FRAGMENT_SPREAD: {
        const fragName = selection.name.value;
        const fragment = compilationContext.fragments[fragName];
        if (
          !fragment ||
          !doesFragmentConditionMatch(compilationContext, fragment, runtimeType)
        ) {
          break;
        }

        const fragmentShouldInclude = andShouldInclude(
          shouldInclude,
          compileSkipInclude(compilationContext, selection)
        );

        // If a fragment is spread multiple times under different @skip/@include checks,
        // one spread may be skipped at runtime while another is included. Visit each
        // fragment's selection set once with a mutable OrNode, and append additional
        // branches on subsequent spreads.
        const visited = visitedFragmentNames[fragName];
        if (visited) {
          addFragmentShouldIncludeBranch(visited, fragmentShouldInclude);
          break;
        }
        const fragmentNode = createFragmentShouldInclude(fragmentShouldInclude);
        visitedFragmentNames[fragName] = fragmentNode;

        pushSelections(fragment.selectionSet.selections, fragmentNode);
        break;
      }
    }
  }

  return fields;
}

function addFieldNode(
  fields: FieldsAndNodes,
  fieldNode: FieldNode,
  shouldInclude: ShouldInclude
) {
  const name = getFieldEntryKey(fieldNode);
  let fieldNodes = fields[name];
  if (!fieldNodes) {
    fieldNodes = fields[name] = [];
  }

  setFieldNodeShouldInclude(fieldNodes, fieldNode, shouldInclude);
  fieldNodes.push(fieldNode);
}

/**
 * Determines if a fragment is applicable to the given type.
 */
function doesFragmentConditionMatch(
  compilationContext: CompilationContext,
  fragment: FragmentDefinitionNode | InlineFragmentNode,
  type: GraphQLObjectType
): boolean {
  const typeConditionNode = fragment.typeCondition;
  if (!typeConditionNode) {
    return true;
  }
  const conditionalType = typeFromAST(
    compilationContext.schema,
    typeConditionNode
  );
  if (conditionalType === type) {
    return true;
  }
  if (!conditionalType) {
    return false;
  }
  if (isAbstractType(conditionalType)) {
    return compilationContext.schema.isSubType(conditionalType, type);
  }
  return false;
}

/**
 * Implements the logic to compute the key of a given field's entry
 */
function getFieldEntryKey(node: FieldNode): string {
  return node.alias ? node.alias.value : node.name.value;
}

export { resolveFieldDef };

export function collectSubfields(
  compilationContext: CompilationContext,
  returnType: GraphQLObjectType,
  fieldNodes: FieldNode[]
): { [key: string]: FieldNode[] } {
  let subFieldNodes = Object.create(null);
  const visitedFragmentNames = Object.create(null);
  for (const fieldNode of fieldNodes) {
    const selectionSet = fieldNode.selectionSet;
    if (selectionSet) {
      // When fieldNodes.length === 1, the parent object already gates the entire
      // sub-object on that fieldNode's condition, so only propagate when multiple
      // fieldNodes merge into the same sub-object.
      const parentShouldInclude =
        fieldNodes.length === 1
          ? ALWAYS_INCLUDE
          : getFieldNodeShouldInclude(fieldNodes, fieldNode) ?? ALWAYS_INCLUDE;
      subFieldNodes = collectFieldsImpl(
        compilationContext,
        returnType,
        selectionSet,
        subFieldNodes,
        visitedFragmentNames,
        parentShouldInclude
      );
    }
  }
  return subFieldNodes;
}

// response path is used for identifying
// the info resolver function as well as the path in errros,
// the meta type is used for elements that are only to be used for
// the function name
type ResponsePathType = "variable" | "literal" | "meta";

export interface ObjectPath {
  prev: ObjectPath | undefined;
  key: string;
  type: ResponsePathType;
}

interface MissingVariablePath {
  valueNode: VariableNode;
  path?: ObjectPath;
  argument?: { definition: GraphQLArgument; node: ArgumentNode };
}

export interface Arguments {
  values: { [argument: string]: any };
  types: { [argument: string]: GraphQLInputType };
  missing: MissingVariablePath[];
}

/**
 * Prepares an object map of argument values given a list of argument
 * definitions and list of argument AST nodes.
 *
 * Note: The returned value is a plain Object with a prototype, since it is
 * exposed to user code. Care should be taken to not pull values from the
 * Object prototype.
 */
export function getArgumentDefs(
  def: GraphQLField<any, any> | GraphQLDirective,
  node: FieldNode | DirectiveNode
): Arguments {
  const values: { [key: string]: any } = {};
  const types: { [key: string]: GraphQLInputType } = {};
  const missing: MissingVariablePath[] = [];
  const argDefs = def.args;
  const argNodes = node.arguments || [];
  const argNodeMap = keyMap(argNodes, (arg) => arg.name.value);
  for (const argDef of argDefs) {
    const name = argDef.name;
    types[name] = argDef.type;
    if (hasDefaultValue(argDef)) {
      // handle v16 defaultValue, and v17 default.value/default.literal
      values[name] = getDefaultValue(argDef);
    }
    const argType = argDef.type;
    const argumentNode = argNodeMap[name];
    let hasVariables = false;
    if (argumentNode && argumentNode.value.kind === Kind.VARIABLE) {
      hasVariables = true;
      missing.push({
        valueNode: argumentNode.value,
        path: addPath(undefined, name, "literal"),
        argument: { definition: argDef, node: argumentNode }
      });
    } else if (argumentNode) {
      const coercedValue = valueFromAST(argumentNode.value, argType);
      if (coercedValue === undefined) {
        // Note: ValuesOfCorrectType validation should catch this before
        // execution. This is a runtime check to ensure execution does not
        // continue with an invalid argument value.
        throw new GraphQLError(
          `Argument "${name}" of type "${argType}" has invalid value ${print(
            argumentNode.value
          )}.`,
          getGraphQLErrorOptions(argumentNode.value)
        );
      }

      if (isASTValueWithVariables(coercedValue)) {
        missing.push(
          ...coercedValue.variables.map(({ valueNode, path }) => ({
            valueNode,
            path: addPath(path, name, "literal")
          }))
        );
      }
      values[name] = coercedValue.value;
    }
    if (isNonNullType(argType) && values[name] === undefined && !hasVariables) {
      // If no value or a nullish value was provided to a variable with a
      // non-null type (required), produce an error.
      throw new GraphQLError(
        argumentNode
          ? `Argument "${name}" of non-null type ` +
            `"${argType}" must not be null.`
          : `Argument "${name}" of required type ` +
            `"${argType}" was not provided.`,
        getGraphQLErrorOptions(node)
      );
    }
  }
  return { values, types, missing };
}

interface ASTValueWithVariables {
  value: object | string | boolean | symbol | number | null | any[];
  variables: MissingVariablePath[];
}

function isASTValueWithVariables(x: any): x is ASTValueWithVariables {
  return !!x.variables;
}

interface ASTValue {
  value: object | string | boolean | symbol | number | null | any[];
}

export function valueFromAST(
  valueNode: ValueNode,
  type: GraphQLInputType
): undefined | ASTValue | ASTValueWithVariables {
  if (isNonNullType(type)) {
    if (valueNode.kind === Kind.NULL) {
      return; // Invalid: intentionally return no value.
    }
    return valueFromAST(valueNode, type.ofType);
  }

  if (valueNode.kind === Kind.NULL) {
    // This is explicitly returning the value null.
    return {
      value: null
    };
  }

  if (valueNode.kind === Kind.VARIABLE) {
    return { value: null, variables: [{ valueNode, path: undefined }] };
  }

  if (isListType(type)) {
    const itemType = type.ofType;
    if (valueNode.kind === Kind.LIST) {
      const coercedValues = [];
      const variables: MissingVariablePath[] = [];
      const itemNodes = valueNode.values;
      for (let i = 0; i < itemNodes.length; i++) {
        const itemNode = itemNodes[i];
        if (itemNode.kind === Kind.VARIABLE) {
          coercedValues.push(null);
          variables.push({
            valueNode: itemNode,
            path: addPath(undefined, i.toString(), "literal")
          });
        } else {
          const itemValue = valueFromAST(itemNode, itemType);
          if (!itemValue) {
            return; // Invalid: intentionally return no value.
          }
          coercedValues.push(itemValue.value);
          if (isASTValueWithVariables(itemValue)) {
            variables.push(
              ...itemValue.variables.map(({ valueNode, path }) => ({
                valueNode,
                path: addPath(path, i.toString(), "literal")
              }))
            );
          }
        }
      }
      return { value: coercedValues, variables };
    }
    // Single item which will be coerced to a list
    const coercedValue = valueFromAST(valueNode, itemType);
    if (coercedValue === undefined) {
      return; // Invalid: intentionally return no value.
    }
    if (isASTValueWithVariables(coercedValue)) {
      return {
        value: [coercedValue.value],
        variables: coercedValue.variables.map(({ valueNode, path }) => ({
          valueNode,
          path: addPath(path, "0", "literal")
        }))
      };
    }
    return { value: [coercedValue.value] };
  }

  if (isInputObjectType(type)) {
    if (valueNode.kind !== Kind.OBJECT) {
      return; // Invalid: intentionally return no value.
    }
    const coercedObj = Object.create(null);
    const variables: MissingVariablePath[] = [];
    const fieldNodes = keyMap(valueNode.fields, (field) => field.name.value);
    const fields = Object.values(type.getFields());
    for (const field of fields) {
      if (hasDefaultValue(field)) {
        coercedObj[field.name] = getDefaultValue(field);
      }
      const fieldNode = fieldNodes[field.name];
      if (!fieldNode) {
        continue;
      }
      const fieldValue = valueFromAST(fieldNode.value, field.type);
      if (!fieldValue) {
        return; // Invalid: intentionally return no value.
      }
      if (isASTValueWithVariables(fieldValue)) {
        variables.push(
          ...fieldValue.variables.map(({ valueNode, path }) => ({
            valueNode,
            path: addPath(path, field.name, "literal")
          }))
        );
      }
      // A variable is only assigned at runtime when provided, otherwise the
      // field keeps its default or stays absent.
      if (fieldNode.value.kind !== Kind.VARIABLE) {
        coercedObj[field.name] = fieldValue.value;
      }
    }
    return { value: coercedObj, variables };
  }

  if (isEnumType(type)) {
    if (valueNode.kind !== Kind.ENUM) {
      return; // Invalid: intentionally return no value.
    }
    const enumValue = type.getValue(valueNode.value);
    if (!enumValue) {
      return; // Invalid: intentionally return no value.
    }
    return { value: enumValue.value };
  }

  if (isScalarType(type)) {
    // Scalars fulfill parsing a literal value via coerceInputLiteral().
    // Invalid values represent a failure to parse correctly, in which case
    // no value is returned.
    let result: any;
    try {
      // By this point, we've filtered out VARIABLE nodes, so valueNode is a ConstValueNode
      result = coerceInputLiteral(type, valueNode as ConstValueNode);
    } catch (error) {
      return; // Invalid: intentionally return no value.
    }
    if (isInvalid(result)) {
      return; // Invalid: intentionally return no value.
    }
    return { value: result };
  }

  // Not reachable. All possible input types have been considered.
  /* istanbul ignore next */
  throw new Error(`Unexpected input type: "${inspect(type)}".`);
}

/**
 * Creates a keyed JS object from an array, given a function to produce the keys
 * for each value in the array.
 *
 * This provides a convenient lookup for the array items if the key function
 * produces unique results.
 *
 *     const phoneBook = [
 *       { name: 'Jon', num: '555-1234' },
 *       { name: 'Jenny', num: '867-5309' }
 *     ]
 *
 *     // { Jon: { name: 'Jon', num: '555-1234' },
 *     //   Jenny: { name: 'Jenny', num: '867-5309' } }
 *     const entriesByName = keyMap(
 *       phoneBook,
 *       entry => entry.name
 *     )
 *
 *     // { name: 'Jenny', num: '857-6309' }
 *     const jennyEntry = entriesByName['Jenny']
 *
 */
function keyMap<T>(
  list: ReadonlyArray<T>,
  keyFn: (item: T) => string
): { [key: string]: T } {
  return list.reduce(
    // eslint-disable-next-line no-sequences
    (map, item) => ((map[keyFn(item)] = item), map),
    Object.create(null)
  );
}

export function computeLocations(nodes: ASTNode[]): SourceLocation[] {
  return nodes.reduce((list, node) => {
    if (node.loc) {
      list.push(getLocation(node.loc));
    }
    return list;
  }, [] as SourceLocation[]);
}

/**
 * This is an alternate faster implementation of getLocation in graphql-js
 *
 * Optimization:
 * In graphql-js, getLocation is implemented as finding line and column
 * from a given position in the source. Since the use-case in GraphQL-JIT
 * is to find the location of a node, we can directly use the line and
 * column from the startToken of the node's location.
 *
 * @param loc the Node's location
 * @returns the SourceLocation for the position
 */
function getLocation(loc: Location): SourceLocation {
  // If the location already contains line and column, return it directly
  return {
    line: loc.startToken.line,
    column: loc.startToken.column
  };
}

export function addPath(
  responsePath: ObjectPath | undefined,
  key: string,
  type: ResponsePathType = "literal"
): ObjectPath {
  return { prev: responsePath, key, type };
}

export function flattenPath(
  path: ObjectPath
): Array<{ key: string; type: ResponsePathType }> {
  const flattened = [];
  let curr: ObjectPath | undefined = path;
  while (curr) {
    flattened.push({ key: curr.key, type: curr.type });
    curr = curr.prev;
  }
  return flattened;
}

function isInvalid(value: any): boolean {
  // eslint-disable-next-line no-self-compare
  return value === undefined || value !== value;
}
