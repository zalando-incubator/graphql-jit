import {
  type GraphQLResolveInfo,
  Kind,
  SelectionNode,
  FieldNode
} from "graphql";
import { type JitFieldNode } from "./ast";

// Simple map: field name -> true/false (should we include this field?)
export type FieldAvailability = Map<string, boolean>;

// Enhanced resolve info with field availability helpers
export interface GraphQLJitResolveInfoWithAvailability
  extends GraphQLResolveInfo {
  fieldAvailability: FieldAvailability;
  isFieldRequested: (fieldName: string) => boolean;
}

// Check if a field should be included (not skipped)
function shouldIncludeField(
  fieldNode: JitFieldNode,
  variables: Record<string, any>,
  currentPath?: string
): boolean {
  // Get the skip/include conditions for this field
  const conditions = getSkipIncludeConditions(fieldNode, currentPath);

  // No conditions? Always include the field
  if (conditions.length === 0) {
    return true;
  }

  // Check all conditions - ALL must be true to include the field
  for (const condition of conditions) {
    if (condition === "true") {
      continue; // Always true, skip checking
    }

    // Run the condition and see if it's true
    if (!runCondition(condition, variables)) {
      return false; // One condition failed, exclude field
    }
  }

  return true; // All conditions passed
}

// Get the skip/include conditions for a field
function getSkipIncludeConditions(
  fieldNode: JitFieldNode,
  currentPath?: string
): string[] {
  // Try new path-based conditions first
  if (fieldNode.__internalShouldIncludePath) {
    const pathKeys = Object.keys(fieldNode.__internalShouldIncludePath);

    // Use current path if available
    if (currentPath && fieldNode.__internalShouldIncludePath[currentPath]) {
      return fieldNode.__internalShouldIncludePath[currentPath];
    }

    // Otherwise use first available path
    if (pathKeys.length > 0) {
      return fieldNode.__internalShouldIncludePath[pathKeys[0]];
    }
  }

  // Fall back to old-style conditions
  if (fieldNode.__internalShouldInclude) {
    return fieldNode.__internalShouldInclude;
  }

  return []; // No conditions found
}

// Run a single condition and return true/false
/* eslint-disable no-new-func */
function runCondition(
  condition: string,
  variables: Record<string, any>
): boolean {
  try {
    const evalFunction = new Function("variableValues", `return ${condition}`);
    return !!evalFunction(variables);
  } catch (error) {
    return true; // Safety: include field if condition fails to evaluate
  }
}
/* eslint-enable no-new-func */

// Create a map of which fields should be included
// NOTE: Fragment are not supported yet
// Only processes immediate children to ensure parent-child separation
export function createFieldAvailability(
  fieldNodes: JitFieldNode[],
  variables: Record<string, any>
): FieldAvailability {
  const fieldMap: FieldAvailability = new Map();

  function collectImmediateFields(
    selections: readonly JitFieldNode[],
    shouldIncludeParent: boolean,
    currentPath: string = ""
  ) {
    if (!shouldIncludeParent) {
      return;
    }

    for (const selection of selections) {
      if (selection.kind === Kind.FIELD) {
        const fieldName = selection.name.value;
        const fieldPath = currentPath
          ? `${currentPath}.${fieldName}`
          : fieldName;

        const shouldInclude = shouldIncludeField(
          selection,
          variables,
          fieldPath
        );

        // Mark field as included if it should be (or if already marked)
        if (!fieldMap.has(fieldName)) {
          fieldMap.set(fieldName, shouldInclude); // First time seeing this field
        } else {
          fieldMap.set(fieldName, fieldMap.get(fieldName)! || shouldInclude); // Combine with existing
        }
      } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
        // Fragment spreads are not supported yet - skip them
        continue;
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        // Inline fragments are not supported yet - skip them
        continue;
      }
    }
  }

  // Process each field node
  for (const fieldNode of fieldNodes) {
    if (fieldNode.selectionSet) {
      const initialPath = fieldNode.name.value;
      collectImmediateFields(
        fieldNode.selectionSet.selections as readonly JitFieldNode[],
        true,
        initialPath
      );
    }
  }

  return fieldMap;
}

// Generate JavaScript code that checks which fields should be included
// Returns a string like: `{"field1": true, "field2": someCondition}`
// Only processes immediate children to ensure parent-child separation
export function generateFieldAvailabilityCode(
  fieldNodes: JitFieldNode[] | FieldNode[]
): string {
  const fieldChecks: string[] = [];

  for (const fieldNode of fieldNodes) {
    if (fieldNode.selectionSet) {
      const initialPath = fieldNode.name.value;
      // Only collect immediate children, not nested descendants
      collectImmediateFieldChecks(
        fieldNode.selectionSet.selections as readonly JitFieldNode[],
        fieldChecks,
        initialPath
      );
    }
  }

  return `{${fieldChecks.join(", ")}}`;
}

// Walk through immediate selections only (no recursive traversal)
// This ensures each resolver only sees fields directly requested from its type
function collectImmediateFieldChecks(
  selections: readonly (JitFieldNode | SelectionNode)[],
  fieldChecks: string[],
  currentPath: string = ""
) {
  for (const selection of selections) {
    if (selection.kind === Kind.FIELD) {
      // Use the actual field name, not the alias
      const fieldName = selection.name.value;
      const jitSelection = selection as JitFieldNode;

      // Start with "always include"
      let condition = "true";

      // Look for skip/include conditions
      if (jitSelection.__internalShouldIncludePath) {
        condition = buildConditionFromPath(jitSelection, currentPath);
      } else if (jitSelection.__internalShouldInclude) {
        condition = buildConditionFromOldPath(jitSelection);
      } else {
        condition = buildConditionFromDirectives(selection);
      }

      // Add this field check to our list using the real field name
      fieldChecks.push(`"${fieldName}": ${condition}`);
    }
  }
}

// Build a condition from path-based skip/include data
function buildConditionFromPath(
  jitSelection: JitFieldNode,
  currentPath: string
): string {
  const pathKeys = Object.keys(jitSelection.__internalShouldIncludePath!);
  let expressions: string[] = [];

  // Try to find expressions for current path
  if (currentPath && jitSelection.__internalShouldIncludePath![currentPath]) {
    expressions = jitSelection.__internalShouldIncludePath![currentPath];
  } else if (pathKeys.length > 0) {
    // Use first available path as fallback
    expressions = jitSelection.__internalShouldIncludePath![pathKeys[0]];
  }

  return combineExpressions(expressions);
}

// Build condition from old-style path data
function buildConditionFromOldPath(jitSelection: JitFieldNode): string {
  const expressions = jitSelection.__internalShouldInclude || [];
  return combineExpressions(expressions);
}

// Combine multiple expressions into one condition
function combineExpressions(expressions: string[]): string {
  if (expressions.length === 0) {
    return "true";
  }

  // Filter out "true" and fix variable references
  const cleanExpressions = expressions
    .filter((expr) => expr !== "true")
    .map((expr) => expr.replace(/__context\.variables\[/g, "variableValues["));

  if (cleanExpressions.length === 0) {
    return "true";
  }

  // Combine multiple conditions with &&
  return cleanExpressions.length === 1
    ? cleanExpressions[0]
    : `(${cleanExpressions.join(") && (")})`;
}

// Build condition from GraphQL @skip and @include directives
function buildConditionFromDirectives(selection: SelectionNode): string {
  const directives = selection.directives;
  if (!directives || directives.length === 0) {
    return "true"; // No directives = always include
  }

  const conditions: string[] = [];

  for (const directive of directives) {
    if (directive.name.value === "skip") {
      // @skip(if: $var) means "don't include if $var is true"
      const ifArg = directive.arguments?.find((arg) => arg.name.value === "if");
      if (ifArg && ifArg.value.kind === Kind.VARIABLE) {
        const varName = ifArg.value.name.value;
        conditions.push(`!(variableValues["${varName}"] === true)`);
      } else if (ifArg && ifArg.value.kind === Kind.BOOLEAN) {
        conditions.push(`!${ifArg.value.value}`);
      }
    } else if (directive.name.value === "include") {
      // @include(if: $var) means "include only if $var is true"
      const ifArg = directive.arguments?.find((arg) => arg.name.value === "if");
      if (ifArg && ifArg.value.kind === Kind.VARIABLE) {
        const varName = ifArg.value.name.value;
        conditions.push(`(variableValues["${varName}"] === true)`);
      } else if (ifArg && ifArg.value.kind === Kind.BOOLEAN) {
        conditions.push(`${ifArg.value.value}`);
      }
    }
  }

  // Combine all conditions
  if (conditions.length === 0) {
    return "true";
  } else if (conditions.length === 1) {
    return conditions[0];
  } else {
    return `(${conditions.join(" && ")})`;
  }
}
