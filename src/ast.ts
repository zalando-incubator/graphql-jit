import {
  coerceValue,
  DirectiveNode,
  FieldNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  getDirectiveValues,
  getLocation,
  GraphQLDirective,
  GraphQLError,
  GraphQLField,
  GraphQLIncludeDirective,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLSkipDirective,
  InlineFragmentNode,
  isInputType,
  isNonNullType,
  print,
  SelectionSetNode,
  SourceLocation,
  typeFromAST,
  valueFromAST,
  VariableDefinitionNode
} from "graphql";
import { ExecutionContext, getFieldDef } from "graphql/execution/execute";
import { CoercedVariableValues } from "graphql/execution/values";
import { Kind } from "graphql/language";
import Maybe from "graphql/tsutils/Maybe";
import { isAbstractType } from "graphql/type";
import { inspect } from "util";

/**
 * Given a selectionSet, adds all of the fields in that selection to
 * the passed in map of fields, and returns it at the end.
 *
 * CollectFields requires the "runtime type" of an object. For a field which
 * returns an Interface or Union type, the "runtime type" will be the actual
 * Object type returned by that field.
 */
export function collectFields(
  exeContext: ExecutionContext,
  runtimeType: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  fields: { [key: string]: FieldNode[] },
  visitedFragmentNames: { [key: string]: boolean }
): { [key: string]: FieldNode[] } {
  for (const selection of selectionSet.selections) {
    switch (selection.kind) {
      case Kind.FIELD:
        if (!shouldIncludeNode(exeContext, selection)) {
          continue;
        }
        const name = getFieldEntryKey(selection);
        if (!fields[name]) {
          fields[name] = [];
        }
        fields[name].push(selection);
        break;
      case Kind.INLINE_FRAGMENT:
        if (
          !shouldIncludeNode(exeContext, selection) ||
          !doesFragmentConditionMatch(exeContext, selection, runtimeType)
        ) {
          continue;
        }
        collectFields(
          exeContext,
          runtimeType,
          selection.selectionSet,
          fields,
          visitedFragmentNames
        );
        break;
      case Kind.FRAGMENT_SPREAD:
        const fragName = selection.name.value;
        if (
          visitedFragmentNames[fragName] ||
          !shouldIncludeNode(exeContext, selection)
        ) {
          continue;
        }
        visitedFragmentNames[fragName] = true;
        const fragment = exeContext.fragments[fragName];
        if (
          !fragment ||
          !doesFragmentConditionMatch(exeContext, fragment, runtimeType)
        ) {
          continue;
        }
        collectFields(
          exeContext,
          runtimeType,
          fragment.selectionSet,
          fields,
          visitedFragmentNames
        );
        break;
    }
  }
  return fields;
}

/**
 * Determines if a field should be included based on the @include and @skip
 * directives, where @skip has higher precedence than @include.
 */
function shouldIncludeNode(
  exeContext: ExecutionContext,
  node: FragmentSpreadNode | FieldNode | InlineFragmentNode
): boolean {
  const skip = getDirectiveValues(
    GraphQLSkipDirective,
    node,
    exeContext.variableValues
  );
  if (skip && skip.if === true) {
    return false;
  }

  const include = getDirectiveValues(
    GraphQLIncludeDirective,
    node,
    exeContext.variableValues
  );
  if (include && include.if === false) {
    return false;
  }
  return true;
}

/**
 * Determines if a fragment is applicable to the given type.
 */
function doesFragmentConditionMatch(
  exeContext: ExecutionContext,
  fragment: FragmentDefinitionNode | InlineFragmentNode,
  type: GraphQLObjectType
): boolean {
  const typeConditionNode = fragment.typeCondition;
  if (!typeConditionNode) {
    return true;
  }
  const conditionalType = typeFromAST(exeContext.schema, typeConditionNode);
  if (conditionalType === type) {
    return true;
  }
  if (!conditionalType) {
    return false;
  }
  if (isAbstractType(conditionalType)) {
    return exeContext.schema.isPossibleType(conditionalType, type);
  }
  return false;
}

/**
 * Implements the logic to compute the key of a given field's entry
 */
function getFieldEntryKey(node: FieldNode): string {
  return node.alias ? node.alias.value : node.name.value;
}

/**
 * Resolves the field on the given source object. In particular, this
 * figures out the value that the field returns by calling its resolve function,
 * then calls completeValue to complete promises, serialize scalars, or execute
 * the sub-selection-set for objects.
 */
export function resolveFieldDef(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  fieldNodes: FieldNode[]
): Maybe<GraphQLField<any, any>> {
  const fieldNode = fieldNodes[0];
  const fieldName = fieldNode.name.value;

  return getFieldDef(exeContext.schema, parentType, fieldName);
}

/**
 * A memoized collection of relevant subfields in the context of the return
 * type. Memoizing ensures the subfields are not repeatedly calculated, which
 * saves overhead when resolving lists of values.
 */
export const collectSubfields = memoize3(_collectSubfields);

function _collectSubfields(
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: FieldNode[]
): { [key: string]: FieldNode[] } {
  let subFieldNodes = Object.create(null);
  const visitedFragmentNames = Object.create(null);
  for (const fieldNode of fieldNodes) {
    const selectionSet = fieldNode.selectionSet;
    if (selectionSet) {
      subFieldNodes = collectFields(
        exeContext,
        returnType,
        selectionSet,
        subFieldNodes,
        visitedFragmentNames
      );
    }
  }
  return subFieldNodes;
}

function memoize3(
  fn: (
    exeContext: ExecutionContext,
    returnType: GraphQLObjectType,
    fieldNodes: FieldNode[]
  ) => { [key: string]: FieldNode[] }
): (
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: FieldNode[]
) => { [key: string]: FieldNode[] } {
  let cache0: WeakMap<any, any>;

  function memoized(a1: any, a2: any, a3: any) {
    if (!cache0) {
      cache0 = new WeakMap();
    }
    let cache1 = cache0.get(a1);
    let cache2;
    if (cache1) {
      cache2 = cache1.get(a2);
      if (cache2) {
        const cachedValue = cache2.get(a3);
        if (cachedValue !== undefined) {
          return cachedValue;
        }
      }
    } else {
      cache1 = new WeakMap();
      cache0.set(a1, cache1);
    }
    if (!cache2) {
      cache2 = new WeakMap();
      cache1.set(a2, cache2);
    }
    const newValue = (fn as any)(...arguments);
    cache2.set(a3, newValue);
    return newValue;
  }

  return memoized;
}

export interface Arguments {
  values: { [argument: string]: any };
  missing: { [argument: string]: any };
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
  const values: any = {};
  const missing: any = {};
  const argDefs = def.args;
  const argNodes = node.arguments;
  if (!argDefs || !argNodes) {
    return { values, missing };
  }
  const argNodeMap = keyMap(argNodes, arg => arg.name.value);
  for (const argDef of argDefs) {
    const name = argDef.name;
    const argType = argDef.type;
    const argumentNode = argNodeMap[name];
    if (argumentNode && argumentNode.value.kind === Kind.VARIABLE) {
      missing[name] = argumentNode.value.name.value;
    } else if (argumentNode) {
      const coercedValue = valueFromAST(argumentNode.value, argType, {});
      if (coercedValue === undefined) {
        // Note: ValuesOfCorrectType validation should catch this before
        // execution. This is a runtime check to ensure execution does not
        // continue with an invalid argument value.
        throw new GraphQLError(
          `Argument "${name}" of type \"${argType}\" has invalid value ${print(argumentNode.value)}.`,
          [argumentNode.value]
        );
      }
      values[name] = coercedValue;
    }
    if (argDef.defaultValue !== undefined && values[name] === undefined) {
      // If no argument was provided where the definition has a default value,
      // use the default value.
      values[name] = argDef.defaultValue;
    }
    if (
      isNonNullType(argType) &&
      values[name] === undefined &&
      missing[name] === undefined
    ) {
      // If no value or a nullish value was provided to a variable with a
      // non-null type (required), produce an error.
      throw new GraphQLError(
        argumentNode
          ? `Argument "${name}" of non-null type ` +
            `"${argType}" must not be null.`
          : `Argument "${name}" of required type ` +
            `"${argType}" was not provided.`,
        [node]
      );
    }
  }
  return { values, missing };
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
    (map, item) => ((map[keyFn(item)] = item), map),
    Object.create(null)
  );
}

/**
 * Prepares an object map of variableValues of the correct type based on the
 * provided variable definitions and arbitrary input. If the input cannot be
 * parsed to match the variable definitions, a GraphQLError will be thrown.
 */
export function getVariableValues(
  schema: GraphQLSchema,
  varDefNodes: ReadonlyArray<VariableDefinitionNode>,
  inputs: { [key: string]: any }
): CoercedVariableValues {
  const errors = [];
  const coercedValues: { [key: string]: any } = Object.create(null);
  for (const varDefNode of varDefNodes) {
    const varName = varDefNode.variable.name.value;
    const varType = typeFromAST(schema, varDefNode.type as any);
    if (!varType || !isInputType(varType)) {
      // Must use input types for variables. This should be caught during
      // validation, however is checked again here for safety.
      errors.push(
        new GraphQLError(
          `Variable "$${varName}" expected value of type ` +
            `"${
              varType ? varType : print(varDefNode.type)
            }" which cannot be used as an input type.`,
          [varDefNode.type]
        )
      );
    } else {
      const hasValue = hasOwnProperty(inputs, varName);
      const value = hasValue ? inputs[varName] : undefined;
      if (!hasValue && varDefNode.defaultValue) {
        // If no value was provided to a variable with a default value,
        // use the default value.
        coercedValues[varName] = valueFromAST(varDefNode.defaultValue, varType);
      } else if ((!hasValue || value === null) && isNonNullType(varType)) {
        // If no value or a nullish value was provided to a variable with a
        // non-null type (required), produce an error.
        errors.push(
          new GraphQLError(
            hasValue
              ? `Variable "$${varName}" of non-null type ` +
                `"${varType}" must not be null.`
              : `Variable "$${varName}" of required type ` +
                `"${varType}" was not provided.`,
            [varDefNode]
          )
        );
      } else if (hasValue) {
        if (value === null) {
          // If the explicit value `null` was provided, an entry in the coerced
          // values must exist as the value `null`.
          coercedValues[varName] = null;
        } else {
          // Otherwise, a non-null value was provided, coerce it to the expected
          // type or report an error if coercion fails.
          const coerced = coerceValue(value, varType, varDefNode);
          const coercionErrors = coerced.errors;
          if (coercionErrors) {
            coercionErrors.forEach((error: Error) => {
              error.message =
                `Variable "$${varName}" got invalid ` +
                `value ${inspect(value)}; ${error.message}`;
            });
            errors.push(...coercionErrors);
          } else {
            coercedValues[varName] = coerced.value;
          }
        }
      }
    }
  }
  return errors.length === 0
    ? { errors: undefined, coerced: coercedValues }
    : { errors, coerced: undefined };
}

export function computeLocations(
  nodes: FieldNode[]
): SourceLocation[] | undefined {
  if (!Array.isArray(nodes) || !nodes.length) {
    return undefined;
  }
  const locations = nodes.reduce(
    (list, node) => {
      if (node.loc) {
        list.push(getLocation(node.loc.source, node.loc.start));
      }
      return list;
    },
    [] as SourceLocation[]
  );
  if (locations.length === 0) {
    return undefined;
  }
  return locations;
}

function hasOwnProperty(obj: any, prop: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}
