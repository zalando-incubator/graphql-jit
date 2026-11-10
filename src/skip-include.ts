import {
  type DirectiveNode,
  type FieldNode,
  GraphQLError,
  GraphQLIncludeDirective,
  GraphQLSkipDirective,
  Kind,
  type SelectionNode,
  type TypeNode,
  valueFromASTUntyped,
  type VariableNode
} from "graphql";
import { type CompilationContext, GLOBAL_VARIABLES_NAME } from "./execution.js";
import { getGraphQLErrorOptions } from "./compat.js";

/**
 * The condition under which a selection is included:
 * It is included if every compiled skip/include expression of at least
 * one of the conjunctions is true.
 *
 * Each conjunction holds the directives along one route of
 * selection sets and fragments.
 *
 * For example,
 *
 * ```graphql
 *   {
 *     user @include(if: $a) { ...UserFields @skip(if: $b) }
 *     user { ... @include(if: $c) { ...UserFields } }
 *   }
 *   fragment UserFields on User { name }
 * ```
 *
 * Route ;; Directives ;; Conjunction
 * 1st user -> ...UserFields -> name ;; include_if $a ;; skip_if $b ;; [a, !b]
 * 2nd user -> ...{} -> ...UserFields ;; include_if $c ;; [c]
 *
 */
export type ShouldInclude = string[][];

// One route with no conditions, i.e. `true`. `[]` (no routes) would be `false`.
export const ALWAYS_INCLUDE: ShouldInclude = [[]];

/**
 * Maps (fieldNodes, fieldNode) to that node's skip/include condition.
 *
 * Keyed by (fieldNodes, fieldNode) rather than FieldNode alone because
 * the same AST node can be collected in multiple places with different
 * conditions.
 */
const shouldIncludeByFieldNodes = new WeakMap<
  FieldNode[],
  Map<FieldNode, ShouldInclude>
>();

export function getFieldNodeShouldInclude(
  fieldNodes: FieldNode[],
  fieldNode: FieldNode
): ShouldInclude | undefined {
  return shouldIncludeByFieldNodes.get(fieldNodes)?.get(fieldNode);
}

export function setFieldNodeShouldInclude(
  fieldNodes: FieldNode[],
  fieldNode: FieldNode,
  shouldInclude: ShouldInclude
) {
  let shouldIncludeByNode = shouldIncludeByFieldNodes.get(fieldNodes);
  if (!shouldIncludeByNode) {
    shouldIncludeByNode = new Map();
    shouldIncludeByFieldNodes.set(fieldNodes, shouldIncludeByNode);
  }
  shouldIncludeByNode.set(fieldNode, shouldInclude);
}

/**
 * Compiles the condition under which a field, collected as the given field
 * nodes, is included in its object. The field is included if at least one
 * of the field nodes is.
 *
 * For example,
 *
 * ```graphql
 * {
 *   foo @skip(if: $c1)
 *   ... @skip(if: $c2) { foo @skip(if: $c3) }
 * }
 * ```
 *
 * The condition for `foo` becomes
 *
 * `(compilationFor($c1)) || (compilationFor($c2) && compilationFor($c3))`
 *
 * @returns "true" if the field is always included
 */
export function compileFieldNodesShouldInclude(
  fieldNodes: FieldNode[]
): string {
  let shouldInclude: ShouldInclude = [];
  for (const fieldNode of fieldNodes) {
    shouldInclude = orShouldInclude(
      shouldInclude,
      getFieldNodeShouldInclude(fieldNodes, fieldNode) ?? ALWAYS_INCLUDE
    );
  }

  if (shouldInclude.some((it) => it.length === 0)) {
    return "true";
  }
  return shouldInclude.map((it) => `(${it.join(" && ")})`).join(" || ");
}

/**
 * Combines `shouldInclude` with `compiledSkipInclude` using `&&`
 * by appending the expression to each route
 */
export function andShouldInclude(
  shouldInclude: ShouldInclude,
  compiledSkipInclude: string
): ShouldInclude {
  // `true` appears for every selection without skip/include directives,
  // and `X && true` is `X`. Leaving it out keeps the generated code small.
  if (compiledSkipInclude === "true") {
    return shouldInclude;
  }
  return shouldInclude.map((it) =>
    it.includes(compiledSkipInclude) ? it : [...it, compiledSkipInclude]
  );
}

/**
 * Combines @param a and @param b using `||`, dropping redundant routes
 * already covered by a broader route.
 *
 * e.g. `[a, b]` when `[a]` exists.
 */
export function orShouldInclude(
  a: ShouldInclude,
  b: ShouldInclude
): ShouldInclude {
  let result = a;
  for (const conjunction of b) {
    if (result.some((it) => isSubset(it, conjunction))) {
      continue;
    }
    result = result.filter((it) => !isSubset(conjunction, it));
    result.push(conjunction);
  }
  return result;
}

function isSubset(a: string[], b: string[]) {
  return a.every((it) => b.includes(it));
}

/**
 * Compiles directives `skip` and `include` and generates the compilation
 * code based on GraphQL specification.
 *
 * @param node {SelectionNode} The selection node (field/fragment/inline-fragment)
 * for which we generate the compiled skipInclude.
 */
export function compileSkipInclude(
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
