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
  GraphQLIncludeDirective,
  type GraphQLInputType,
  GraphQLObjectType,
  GraphQLSkipDirective,
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
  valueFromASTUntyped,
  type ValueNode,
  type VariableNode,
  Kind,
  type SelectionNode,
  type TypeNode,
  isAbstractType,
  Source,
  Location
} from "graphql";
import { type CompilationContext, GLOBAL_VARIABLES_NAME } from "./execution.js";
import createInspect from "./inspect.js";
import { getGraphQLErrorOptions, resolveFieldDef } from "./compat.js";

export interface JitFieldNode extends FieldNode {
  /**
   * @deprecated Use __internalShouldIncludePath instead
   * @see __internalShouldIncludePath
   */
  __internalShouldInclude?: string[];

  // The shouldInclude logic is specific to the current path
  // This is because the same fieldNode can be reached from different paths
  // - for example, the same fragment used in two different places
  __internalShouldIncludePath?: {
    // Key is the stringified ObjectPath,
    // Value is the shouldInclude logic for that path
    [path: string]: string[];
  };
}

export interface FieldsAndNodes {
  [key: string]: JitFieldNode[];
}

const inspect = createInspect();

/**
 * Given a selectionSet, adds all of the fields in that selection to
 * the passed in map of fields, and returns it at the end.
 *
 * CollectFields requires the "runtime type" of an object. For a field which
 * returns an Interface or Union type, the "runtime type" will be the actual
 * Object type returned by that field.
 */
export function collectFields(
  compilationContext: CompilationContext,
  runtimeType: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  fields: FieldsAndNodes,
  visitedFragmentNames: { [key: string]: boolean },
  parentResponsePath?: ObjectPath
): FieldsAndNodes {
  return collectFieldsImpl(
    compilationContext,
    runtimeType,
    selectionSet,
    fields,
    visitedFragmentNames,
    undefined,
    serializeObjectPathForSkipInclude(parentResponsePath)
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
  visitedFragmentNames: { [key: string]: boolean },
  previousShouldInclude: string[] = [],
  parentResponsePath = ""
): FieldsAndNodes {
  interface StackItem {
    selectionSet: SelectionSetNode;
    parentResponsePath: string;
    previousShouldInclude: string[];
  }

  const stack: StackItem[] = [];

  stack.push({
    selectionSet,
    parentResponsePath,
    previousShouldInclude
  });

  while (stack.length > 0) {
    const { selectionSet, parentResponsePath, previousShouldInclude } =
      stack.pop()!;

    for (const selection of selectionSet.selections) {
      switch (selection.kind) {
        case Kind.FIELD: {
          collectFieldsForField({
            compilationContext,
            fields,
            parentResponsePath,
            previousShouldInclude,
            selection
          });
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
            continue;
          }

          // current fragment's shouldInclude
          const compiledSkipInclude = compileSkipInclude(
            compilationContext,
            selection
          );

          // push to stack
          stack.push({
            selectionSet: selection.selectionSet,
            parentResponsePath: parentResponsePath,
            previousShouldInclude: joinShouldIncludeCompilations(
              // `should include`s from previous fragments
              previousShouldInclude,
              // current fragment's shouldInclude
              [compiledSkipInclude]
            )
          });
          break;
        }

        case Kind.FRAGMENT_SPREAD: {
          const fragName = selection.name.value;
          if (visitedFragmentNames[fragName]) {
            continue;
          }
          visitedFragmentNames[fragName] = true;
          const fragment = compilationContext.fragments[fragName];
          if (
            !fragment ||
            !doesFragmentConditionMatch(
              compilationContext,
              fragment,
              runtimeType
            )
          ) {
            continue;
          }

          // current fragment's shouldInclude
          const compiledSkipInclude = compileSkipInclude(
            compilationContext,
            selection
          );

          // push to stack
          stack.push({
            selectionSet: fragment.selectionSet,
            parentResponsePath,
            previousShouldInclude: joinShouldIncludeCompilations(
              // `should include`s from previous fragments
              previousShouldInclude,
              // current fragment's shouldInclude
              [compiledSkipInclude]
            )
          });
          break;
        }
      }
    }
  }

  return fields;
}

function collectFieldsForField({
  compilationContext,
  fields,
  parentResponsePath,
  previousShouldInclude,
  selection
}: {
  compilationContext: CompilationContext;
  fields: FieldsAndNodes;
  parentResponsePath: string;
  previousShouldInclude: string[];
  selection: FieldNode;
}) {
  const name = getFieldEntryKey(selection);
  if (!fields[name]) {
    fields[name] = [];
  }
  const fieldNode: JitFieldNode = selection;

  // the current path of the field
  // This is used to generate per path skip/include code
  // because the same field can be reached from different paths (e.g. fragment reuse)
  const currentPath = joinSkipIncludePath(
    parentResponsePath,

    // use alias(instead of selection.name.value) if available as the responsePath used for lookup uses alias
    name
  );

  // `should include`s generated for the current fieldNode
  const compiledSkipInclude = compileSkipInclude(compilationContext, selection);

  /**
   * Carry over fragment's skip and include code
   *
   * fieldNode.__internalShouldInclude
   * ---------------------------------
   * When the parent field has a skip or include, the current one
   * should be skipped if the parent is skipped in the path.
   *
   * previousShouldInclude
   * ---------------------
   * `should include`s from fragment spread and inline fragments
   *
   * compileSkipInclude(selection)
   * -----------------------------
   * `should include`s generated for the current fieldNode
   */
  if (compilationContext.options.useExperimentalPathBasedSkipInclude) {
    if (!fieldNode.__internalShouldIncludePath)
      fieldNode.__internalShouldIncludePath = {};

    fieldNode.__internalShouldIncludePath[currentPath] =
      joinShouldIncludeCompilations(
        fieldNode.__internalShouldIncludePath?.[currentPath] ?? [],
        previousShouldInclude,
        [compiledSkipInclude]
      );
  } else {
    // @deprecated
    fieldNode.__internalShouldInclude = joinShouldIncludeCompilations(
      fieldNode.__internalShouldInclude ?? [],
      previousShouldInclude,
      [compiledSkipInclude]
    );
  }
  /**
   * We augment the entire subtree as the parent object's skip/include
   * directives influence the child even if the child doesn't have
   * skip/include on it's own.
   *
   * Refer the function definition for example.
   */
  augmentFieldNodeTree(compilationContext, fieldNode, currentPath);

  fields[name].push(fieldNode);
}

/**
 * Augment __internalShouldInclude code for all sub-fields in the
 * tree with @param rootfieldNode as the root.
 *
 * This is required to handle cases where there are multiple paths to
 * the same node. And each of those paths contain different skip/include
 * values.
 *
 * For example,
 *
 * ```
 * {
 *   foo @skip(if: $c1) {
 *     bar @skip(if: $c2)
 *   }
 *   ... {
 *     foo @skip(if: $c3) {
 *       bar
 *     }
 *   }
 * }
 * ```
 *
 * We decide shouldInclude at runtime per fieldNode. When we handle the
 * field `foo`, the logic is straight forward - it requires one of $c1 or $c3
 * to be false.
 *
 * But, when we handle the field `bar`, and we are in the context of the fieldNode,
 * not enough information is available. This is because, if we only included $c2
 * to decide if bar is included, consider the case -
 *
 * $c1: true, $c2: true, $c3: false
 *
 * If we considered only $c2, we would have skipped bar. But the correct implementation
 * is to include bar, because foo($c3) { bar } is not skipped. The entire sub-tree's
 * logic is required to handle bar.
 *
 * So, to handle this case, we augment the tree at each point to consider the
 * skip/include logic from the parent as well.
 *
 * @param compilationContext {CompilationContext} Required for getFragment by
 * name to handle fragment spread operation.
 *
 * @param rootFieldNode {JitFieldNode} The root field to traverse from for
 * adding __internalShouldInclude to all sub field nodes.
 *
 * @param parentResponsePath {string} The response path of the parent field.
 */
function augmentFieldNodeTree(
  compilationContext: CompilationContext,
  rootFieldNode: JitFieldNode,
  parentResponsePath: string
) {
  for (const selection of rootFieldNode.selectionSet?.selections ?? []) {
    /**
     * Traverse through sub-selection and combine `shouldInclude`s
     * from parent and current ones.
     */
    interface StackItem {
      parentFieldNode: JitFieldNode;
      selection: SelectionNode;
      comesFromFragmentSpread: boolean;
      parentResponsePath: string;
    }

    const stack: StackItem[] = [];

    stack.push({
      parentFieldNode: rootFieldNode,
      selection,
      comesFromFragmentSpread: false,
      parentResponsePath
    });

    while (stack.length > 0) {
      const {
        parentFieldNode,
        selection,
        comesFromFragmentSpread,
        parentResponsePath
      } = stack.pop()!;

      switch (selection.kind) {
        case Kind.FIELD: {
          const jitFieldNode: JitFieldNode = selection;
          const currentPath = joinSkipIncludePath(
            parentResponsePath,

            // use alias(instead of selection.name.value) if available as the responsePath used for lookup uses alias
            getFieldEntryKey(jitFieldNode)
          );

          if (!comesFromFragmentSpread) {
            if (
              compilationContext.options.useExperimentalPathBasedSkipInclude
            ) {
              if (!jitFieldNode.__internalShouldIncludePath)
                jitFieldNode.__internalShouldIncludePath = {};

              jitFieldNode.__internalShouldIncludePath[currentPath] =
                joinShouldIncludeCompilations(
                  parentFieldNode.__internalShouldIncludePath?.[
                    parentResponsePath
                  ] ?? [],
                  jitFieldNode.__internalShouldIncludePath?.[currentPath] ?? []
                );
            } else {
              // @deprecated
              jitFieldNode.__internalShouldInclude =
                joinShouldIncludeCompilations(
                  parentFieldNode.__internalShouldInclude ?? [],
                  jitFieldNode.__internalShouldInclude ?? []
                );
            }
          }
          // go further down the query tree
          for (const selection of jitFieldNode.selectionSet?.selections ?? []) {
            stack.push({
              parentFieldNode: jitFieldNode,
              selection,
              comesFromFragmentSpread: false,
              parentResponsePath: currentPath
            });
          }
          break;
        }
        case Kind.INLINE_FRAGMENT: {
          for (const subSelection of selection.selectionSet.selections) {
            stack.push({
              parentFieldNode,
              selection: subSelection,
              comesFromFragmentSpread: true,
              parentResponsePath
            });
          }
          break;
        }
        case Kind.FRAGMENT_SPREAD: {
          const fragment = compilationContext.fragments[selection.name.value];
          for (const subSelection of fragment.selectionSet.selections) {
            stack.push({
              parentFieldNode,
              selection: subSelection,
              comesFromFragmentSpread: true,
              parentResponsePath
            });
          }
        }
      }
    }
  }
}

/**
 * Joins a list of shouldInclude compiled code into a single logical
 * statement.
 *
 * The operation is `&&` because, it is used to join parent->child
 * relations in the query tree. Note: parent can be either parent field
 * or fragment.
 *
 * For example,
 * {
 *   foo @skip(if: $c1) {
 *     ... @skip(if: $c2) {
 *       bar @skip(if: $c3)
 *     }
 *   }
 * }
 *
 * Only when a parent is included, the child is included. So, we use `&&`.
 *
 * compilationFor($c1) && compilationFor($c2) && compilationFor($c3)
 *
 * @param compilations
 */
function joinShouldIncludeCompilations(...compilations: string[][]): string[] {
  // remove "true" since we are joining with '&&' as `true && X` = `X`
  // This prevents an explosion of `&& true` which could break
  // V8's internal size limit for string.
  //
  // Note: the `true` appears if a field does not have a skip/include directive
  // So, the more nested the query is, the more of unnecessary `&& true`
  // we get.
  //
  // Failing to do this results in [RangeError: invalid array length]
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Invalid_array_length

  const conditionsSet = new Set<string>();
  for (const conditions of compilations) {
    for (const condition of conditions) {
      if (condition !== "true") {
        conditionsSet.add(condition);
      }
    }
  }

  return Array.from(conditionsSet);
}

/**
 * Compiles directives `skip` and `include` and generates the compilation
 * code based on GraphQL specification.
 *
 * @param node {SelectionNode} The selection node (field/fragment/inline-fragment)
 * for which we generate the compiled skipInclude.
 */
function compileSkipInclude(
  compilationContext: CompilationContext,
  node: SelectionNode
): string {
  // minor optimization to avoid compilation if there are no directives
  if (node.directives == null || node.directives.length < 1) {
    return "true";
  }

  const { skipValue, includeValue } = compileSkipIncludeDirectiveValues(
    compilationContext,
    node
  );

  /**
   * Spec: https://spec.graphql.org/June2018/#sec--include
   *
   * Neither @skip nor @include has precedence over the other.
   * In the case that both the @skip and @include directives
   * are provided in on the same the field or fragment, it must
   * be queried only if the @skip condition is false and the
   * @include condition is true. Stated conversely, the field
   * or fragment must not be queried if either the @skip
   * condition is true or the @include condition is false.
   */
  if (skipValue != null && includeValue != null) {
    return `${skipValue} === false && ${includeValue} === true`;
  } else if (skipValue != null) {
    return `(${skipValue} === false)`;
  } else if (includeValue != null) {
    return `(${includeValue} === true)`;
  } else {
    return `true`;
  }
}

/**
 * Compile skip or include directive values into JIT compatible
 * runtime code.
 *
 * @param node {SelectionNode}
 */
function compileSkipIncludeDirectiveValues(
  compilationContext: CompilationContext,
  node: SelectionNode
) {
  const skipDirective = node.directives?.find(
    (it) => it.name.value === GraphQLSkipDirective.name
  );
  const includeDirective = node.directives?.find(
    (it) => it.name.value === GraphQLIncludeDirective.name
  );

  const skipValue = skipDirective
    ? compileSkipIncludeDirective(compilationContext, skipDirective)
    : // The null here indicates the absense of the directive
      // which is later used to determine if both skip and include
      // are present
      null;
  const includeValue = includeDirective
    ? compileSkipIncludeDirective(compilationContext, includeDirective)
    : // The null here indicates the absense of the directive
      // which is later used to determine if both skip and include
      // are present
      null;

  return { skipValue, includeValue };
}

/**
 * Compile the skip/include directive node. Resolve variables to it's
 * path from context, resolve scalars to their respective values.
 *
 * @param directive {DirectiveNode}
 */
function compileSkipIncludeDirective(
  compilationContext: CompilationContext,
  directive: DirectiveNode
) {
  const ifNode = directive.arguments?.find((it) => it.name.value === "if");
  if (ifNode == null) {
    throw new GraphQLError(
      `Directive '${directive.name.value}' is missing required arguments: 'if'`,
      getGraphQLErrorOptions([directive])
    );
  }

  switch (ifNode.value.kind) {
    case Kind.VARIABLE:
      validateSkipIncludeVariableType(compilationContext, ifNode.value);
      return `${GLOBAL_VARIABLES_NAME}["${ifNode.value.name.value}"]`;
    case Kind.BOOLEAN:
      return `${ifNode.value.value.toString()}`;
    default:
      throw new GraphQLError(
        `Argument 'if' on Directive '${
          directive.name.value
        }' has an invalid value (${valueFromASTUntyped(
          ifNode.value
        )}). Expected type 'Boolean!'`,
        getGraphQLErrorOptions([ifNode])
      );
  }
}

/**
 * Validate the skip and include directive's argument values at compile time.
 *
 * This validation step is required as these directives are part of an
 * implicit schema in GraphQL.
 *
 * @param compilationContext {CompilationContext}
 * @param variable {VariableNode} the variable used in 'if' argument of the skip/include directive
 */
function validateSkipIncludeVariableType(
  compilationContext: CompilationContext,
  variable: VariableNode
) {
  const variableDefinition =
    compilationContext.operation.variableDefinitions?.find(
      (it) => it.variable.name.value === variable.name.value
    );
  if (variableDefinition == null) {
    throw new GraphQLError(
      `Variable '${variable.name.value}' is not defined`,
      getGraphQLErrorOptions([variable])
    );
  }

  // Part of Spec text: https://spec.graphql.org/June2018/#sec-All-Variable-Usages-are-Allowed
  if (
    !(
      // The variable defintion is a Non-nullable Boolean type
      (
        (variableDefinition.type.kind === Kind.NON_NULL_TYPE &&
          variableDefinition.type.type.kind === Kind.NAMED_TYPE &&
          variableDefinition.type.type.name.value === "Boolean") ||
        // or the variable definition is a nullable Boolean type with a default value
        (variableDefinition.type.kind === Kind.NAMED_TYPE &&
          variableDefinition.type.name.value === "Boolean" &&
          variableDefinition.defaultValue != null)
      )
    )
  ) {
    throw new GraphQLError(
      `Variable '${variable.name.value}' of type '${typeNodeToString(
        variableDefinition.type
      )}' used in position expecting type 'Boolean!'`,
      getGraphQLErrorOptions([variableDefinition])
    );
  }
}

/**
 * Print the string representation of the TypeNode for error messages
 *
 * @param type {TypeNode} type node to be converted to string representation
 */
function typeNodeToString(type: TypeNode): string {
  switch (type.kind) {
    case Kind.NAMED_TYPE:
      return type.name.value;
    case Kind.NON_NULL_TYPE:
      return `${typeNodeToString(type.type)}!`;
    case Kind.LIST_TYPE:
      return `[${typeNodeToString(type.type)}]`;
  }
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
  fieldNodes: FieldNode[],
  parentResponsePath?: ObjectPath
): { [key: string]: FieldNode[] } {
  let subFieldNodes = Object.create(null);
  const visitedFragmentNames = Object.create(null);
  for (const fieldNode of fieldNodes) {
    const selectionSet = fieldNode.selectionSet;
    if (selectionSet) {
      subFieldNodes = collectFields(
        compilationContext,
        returnType,
        selectionSet,
        subFieldNodes,
        visitedFragmentNames,
        parentResponsePath
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
  const missing: MissingVariablePath[] = [];
  const argDefs = def.args;
  const argNodes = node.arguments || [];
  const argNodeMap = keyMap(argNodes, (arg) => arg.name.value);
  for (const argDef of argDefs) {
    const name = argDef.name;
    if (argDef.defaultValue !== undefined) {
      // Set the coerced value to the default
      values[name] = argDef.defaultValue;
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
  return { values, missing };
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
      if (field.defaultValue !== undefined) {
        coercedObj[field.name] = field.defaultValue;
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
      coercedObj[field.name] = fieldValue.value;
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
    // Scalars fulfill parsing a literal value via parseLiteral().
    // Invalid values represent a failure to parse correctly, in which case
    // no value is returned.
    let result: any;
    try {
      if (type.parseLiteral.length > 1) {
        // eslint-disable-next-line
        console.error(
          "Scalar with variable inputs detected for parsing AST literals. This is not supported."
        );
      }
      result = type.parseLiteral(valueNode, {});
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

/**
 * Serialize a path for use in the skip/include directives.
 *
 * @param path The path to serialize
 * @returns The path serialized as a string, with the root path first.
 */
export function serializeObjectPathForSkipInclude(
  path: ObjectPath | undefined
) {
  let serialized = "";
  let curr = path;
  while (curr) {
    if (curr.type === "literal") {
      serialized = joinSkipIncludePath(curr.key, serialized);
    }
    curr = curr.prev;
  }
  return serialized;
}

/**
 * join two path segments to a dot notation, handling empty strings
 *
 * @param a path segment
 * @param b path segment
 * @returns combined path in dot notation
 */
export function joinSkipIncludePath(a: string, b: string) {
  if (a) {
    if (b) {
      return `${a}.${b}`;
    }
    return a;
  }
  return b;
}

function isInvalid(value: any): boolean {
  // eslint-disable-next-line no-self-compare
  return value === undefined || value !== value;
}
