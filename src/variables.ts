import {
  getVariableValues,
  GraphQLError,
  GraphQLSchema,
  VariableDefinitionNode
} from "graphql";

interface FailedVariableCoercion {
  errors: ReadonlyArray<GraphQLError>;
}

interface VariableValues {
  coerced: { [key: string]: any };
}

export type CoercedVariableValues = FailedVariableCoercion | VariableValues;

export function failToParseVariables(x: any): x is FailedVariableCoercion {
  return x.errors;
}

export function getVariablesParser(
  schema: GraphQLSchema,
  varDefNodes: ReadonlyArray<VariableDefinitionNode>
): (inputs: { [key: string]: any }) => CoercedVariableValues {
  return (inputs) => getVariableValues(schema, varDefNodes, inputs);
}
