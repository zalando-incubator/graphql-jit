import genFn from "generate-function";
import {
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputType,
  GraphQLInt,
  GraphQLSchema,
  GraphQLString,
  isEnumType,
  isInputType,
  isListType,
  isNonNullType,
  isScalarType,
  print,
  SourceLocation,
  typeFromAST,
  valueFromAST,
  VariableDefinitionNode
} from "graphql";
import { addPath, computeLocations, ObjectPath } from "./ast";
import { GraphQLError as GraphQLJITError } from "./error";
import createInspect from "./inspect";

const inspect = createInspect();

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

interface CompilationContext {
  inputPath: ObjectPath;
  responsePath: ObjectPath;
  depth: number;
  varDefNode: VariableDefinitionNode;
  dependencies: Map<string, (...args: any[]) => any>;
  errorMessage?: string;
}

function createSubCompilationContext(
  context: CompilationContext
): CompilationContext {
  return { ...context };
}
export function compileVariableParsing(
  schema: GraphQLSchema,
  varDefNodes: ReadonlyArray<VariableDefinitionNode>
): (inputs: { [key: string]: any }) => CoercedVariableValues {
  const errors = [];
  const coercedValues: { [key: string]: any } = Object.create(null);

  let mainBody = "";
  const dependencies = new Map();
  for (const varDefNode of varDefNodes) {
    const context: CompilationContext = {
      varDefNode,
      depth: 0,
      inputPath: addPath(undefined, "input"),
      responsePath: addPath(undefined, "coerced"),
      dependencies
    };
    const varName = varDefNode.variable.name.value;
    const varType = typeFromAST(schema, varDefNode.type as any);
    if (!varType || !isInputType(varType)) {
      // Must use input types for variables. This should be caught during
      // validation, however is checked again here for safety.
      errors.push(
        new (GraphQLJITError as any)(
          `Variable "$${varName}" expected value of type ` +
            `"${
              varType || print(varDefNode.type)
            }" which cannot be used as an input type.`,
          computeLocations([varDefNode.type])
        )
      );
      continue;
    }

    // Ensure a constant shape of the input map
    coercedValues[varName] = undefined;
    const hasValueName = hasValue(addPath(context.inputPath, varName));
    mainBody += `const ${hasValueName} = Object.prototype.hasOwnProperty.call(${getObjectPath(
      context.inputPath
    )}, "${varName}");\n`;
    context.inputPath = addPath(context.inputPath, varName);
    context.responsePath = addPath(context.responsePath, varName);
    mainBody += generateInput(
      context,
      varType,
      varName,
      hasValueName,
      valueFromAST(varDefNode.defaultValue, varType),
      false
    );
  }

  if (errors.length > 0) {
    throw errors;
  }

  const gen = genFn();
  gen(`
    return function getVariables(input) {
      const errors = [];
      const coerced = ${JSON.stringify(coercedValues)}
      ${mainBody}
      if (errors.length > 0) {
        return {errors, coerced: undefined};
      }
      return {errors: undefined, coerced};
    }
  `);

  // eslint-disable-next-line
  return Function.apply(
    null,
    ["GraphQLJITError", "inspect"]
      .concat(Array.from(dependencies.keys()))
      .concat(gen.toString())
  ).apply(
    null,
    [GraphQLJITError, inspect].concat(Array.from(dependencies.values()))
  );
}

// Int Scalars represent 32 bits
// https://graphql.github.io/graphql-spec/June2018/#sec-Int
const MAX_32BIT_INT = 2147483647;
const MIN_32BIT_INT = -2147483648;

function generateInput(
  context: CompilationContext,
  varType: GraphQLInputType,
  varName: string,
  hasValueName: string,
  defaultValue: unknown | undefined,
  wrapInList: boolean
) {
  const currentOutput = getObjectPath(context.responsePath);
  const currentInput = getObjectPath(context.inputPath);
  const errorLocation = printErrorLocation(
    computeLocations([context.varDefNode])
  );

  const gen = genFn();
  gen(`if (${currentInput} == null) {`);

  if (isNonNullType(varType)) {
    let nonNullMessage;
    let omittedMessage;
    if (context.errorMessage) {
      const objectPath = printObjectPath(context.responsePath);
      nonNullMessage = `${context.errorMessage} + \`Expected non-nullable type ${varType} not to be null at ${objectPath}.\``;
      omittedMessage = `${context.errorMessage} + \`Field ${objectPath} of required type ${varType} was not provided.\``;
    } else {
      nonNullMessage = `'Variable "$${varName}" of non-null type "${varType}" must not be null.'`;
      omittedMessage = `'Variable "$${varName}" of required type "${varType}" was not provided.'`;
    }
    varType = varType.ofType;
    gen(`
      if (${currentOutput} == null) {
        errors.push(new GraphQLJITError(${hasValueName} ? ${nonNullMessage} : ${omittedMessage}, ${errorLocation}));
      }
    `);
  } else {
    gen(`
      if (${hasValueName}) { ${currentOutput} = null; }
    `);
    if (defaultValue !== undefined) {
      gen(`else { ${currentOutput} = ${JSON.stringify(defaultValue)} }`);
    }
  }
  gen(`} else {`);
  if (isScalarType(varType)) {
    switch (varType.name) {
      case GraphQLID.name:
        gen(`
          if (typeof ${currentInput} === "string") {
            ${currentOutput} = ${currentInput};
          } else if (Number.isInteger(${currentInput})) {
            ${currentOutput} = ${currentInput}.toString();
          } else {
            errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
              inspect(${currentInput}) + "; " +
              'Expected type ${varType.name}; ' +
              '${varType.name} cannot represent value: ' +
              inspect(${currentInput}), ${errorLocation})
            );
          }
        `);
        break;
      case GraphQLString.name:
        gen(`
          if (typeof ${currentInput} === "string") {
              ${currentOutput} = ${currentInput};
          } else {
            errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
              inspect(${currentInput}) + "; " +
              'Expected type ${varType.name}; ' +
              '${varType.name} cannot represent a non string value: ' +
              inspect(${currentInput}), ${errorLocation})
            );
          }
        `);
        break;
      case GraphQLBoolean.name:
        gen(`
        if (typeof ${currentInput} === "boolean") {
            ${currentOutput} = ${currentInput};
        } else {
          errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
          inspect(${currentInput}) + "; " +
          'Expected type ${varType.name}; ' +
          '${varType.name} cannot represent a non boolean value: ' +
          inspect(${currentInput}), ${errorLocation}));
        }
        `);
        break;
      case GraphQLInt.name:
        gen(`
        if (Number.isInteger(${currentInput})) {
          if (${currentInput} > ${MAX_32BIT_INT} || ${currentInput} < ${MIN_32BIT_INT}) {
            errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
            inspect(${currentInput}) + "; " +
            'Expected type ${varType.name}; ' +
            '${varType.name} cannot represent non 32-bit signed integer value: ' +
            inspect(${currentInput}), ${errorLocation}));
          } else {
            ${currentOutput} = ${currentInput};
          }
        } else {
          errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
            inspect(${currentInput}) + "; " +
            'Expected type ${varType.name}; ' +
            '${varType.name} cannot represent non-integer value: ' +
            inspect(${currentInput}), ${errorLocation})
          );
        }
        `);
        break;
      case GraphQLFloat.name:
        gen(`
        if (Number.isFinite(${currentInput})) {
            ${currentOutput} = ${currentInput};
        } else {
          errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
            inspect(${currentInput}) + "; " +
            'Expected type ${varType.name}; ' +
            '${varType.name} cannot represent non numeric value: ' +
            inspect(${currentInput}), ${errorLocation})
          );
        }
        `);
        break;
      default:
        context.dependencies.set(
          `${varType.name}parseValue`,
          varType.parseValue.bind(varType)
        );
        gen(`
          try {
            const parseResult = ${varType.name}parseValue(${currentInput});
            if (parseResult === undefined || parseResult !== parseResult) {
              errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
              inspect(${currentInput}) + "; " +
              'Expected type ${varType.name}.', ${errorLocation}));
            }
            ${currentOutput} = parseResult;
          } catch (error) {
            errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
              inspect(${currentInput}) + "; " +
              'Expected type ${varType.name}.', ${errorLocation}, undefined, error)
            );
          }
        `);
    }
  } else if (isEnumType(varType)) {
    context.dependencies.set(
      `${varType.name}getValue`,
      varType.getValue.bind(varType)
    );
    gen(`
      if (typeof ${currentInput} === "string") {
        const enumValue = ${varType.name}getValue(${currentInput});
        if (enumValue) {
          ${currentOutput} = enumValue.value;
        } else {
          errors.push(
            new GraphQLJITError('Variable "$${varName}" got invalid value ' +
            inspect(${currentInput}) + "; " +
            'Expected type ${varType.name}.', ${errorLocation})
          );
        }
      } else {
        errors.push(
          new GraphQLJITError('Variable "$${varName}" got invalid value ' +
          inspect(${currentInput}) + "; " +
          'Expected type ${varType.name}.', ${errorLocation})
        );
      }
      `);
  } else if (isListType(varType)) {
    context.errorMessage = `'Variable "$${varName}" got invalid value ' + inspect(${currentInput}) + '; '`;
    const hasValueName = hasValue(context.inputPath);
    const index = `idx${context.depth}`;

    const subContext = createSubCompilationContext(context);
    subContext.responsePath = addPath(
      subContext.responsePath,
      index,
      "variable"
    );
    subContext.inputPath = addPath(subContext.inputPath, index, "variable");
    subContext.depth++;
    gen(`
      if (Array.isArray(${currentInput})) {
        ${currentOutput} = [];
        for (let ${index} = 0; ${index} < ${currentInput}.length; ++${index}) {
          const ${hasValueName} =
          ${getObjectPath(subContext.inputPath)} !== undefined;
          ${generateInput(
            subContext,
            varType.ofType,
            varName,
            hasValueName,
            undefined,
            false
          )}
        }
      } else {
        ${generateInput(
          context,
          varType.ofType,
          varName,
          hasValueName,
          undefined,
          true
        )}
      }
    `);
  } else if (isInputType(varType)) {
    gen(`
      if (typeof ${currentInput} !== 'object') {
        errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
        inspect(${currentInput}) + "; " +
        'Expected type ${varType.name} to be an object.', ${errorLocation}));
      } else {
        ${currentOutput} = {};
    `);
    const fields = varType.getFields();
    const allowedFields = [];
    for (const field of Object.values(fields)) {
      const subContext = createSubCompilationContext(context);
      allowedFields.push(field.name);
      const hasValueName = hasValue(addPath(subContext.inputPath, field.name));
      gen(`
        const ${hasValueName} = Object.prototype.hasOwnProperty.call(
          ${getObjectPath(subContext.inputPath)}, "${field.name}"
        );
      `);
      subContext.inputPath = addPath(subContext.inputPath, field.name);
      subContext.responsePath = addPath(subContext.responsePath, field.name);
      subContext.errorMessage = `'Variable "$${varName}" got invalid value ' + inspect(${currentInput}) + '; '`;
      gen(`
        ${generateInput(
          subContext,
          field.type,
          field.name,
          hasValueName,
          field.defaultValue,
          false
        )}
      `);
    }

    gen(`
      const allowedFields = ${JSON.stringify(allowedFields)};
      for (const fieldName of Object.keys(${currentInput})) {
        if (!allowedFields.includes(fieldName)) {
          errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
            inspect(${currentInput}) + "; " +
            'Field "' + fieldName + '" is not defined by type ${
              varType.name
            }.', ${errorLocation}));
          break;
        }
      }
    }`);
  } else {
    /* istanbul ignore next line */
    throw new Error(`unknown type: ${varType}`);
  }
  if (wrapInList) {
    gen(`${currentOutput} = [${currentOutput}];`);
  }
  gen(`}`);
  return gen.toString();
}

function hasValue(path: ObjectPath) {
  const flattened = [];
  let curr: ObjectPath | undefined = path;
  while (curr) {
    flattened.push(curr.key);
    curr = curr.prev;
  }
  return `hasValue${flattened.join("_")}`;
}

function printErrorLocation(location: SourceLocation[]) {
  return JSON.stringify(location);
}

function getObjectPath(path: ObjectPath): string {
  const flattened = [];
  let curr: ObjectPath | undefined = path;
  while (curr) {
    flattened.unshift({ key: curr.key, type: curr.type });
    curr = curr.prev;
  }
  let name = flattened[0].key;
  for (let i = 1; i < flattened.length; ++i) {
    name +=
      flattened[i].type === "literal"
        ? `["${flattened[i].key}"]`
        : `[${flattened[i].key}]`;
  }
  return name;
}

function printObjectPath(path: ObjectPath) {
  const flattened = [];
  let curr: ObjectPath | undefined = path;
  while (curr) {
    flattened.unshift({ key: curr.key, type: curr.type });
    curr = curr.prev;
  }
  const initialIndex = Math.min(flattened.length - 1, 1);
  let name = "value";
  for (let i = initialIndex + 1; i < flattened.length; ++i) {
    name +=
      flattened[i].type === "literal"
        ? `.${flattened[i].key}`
        : `[$\{${flattened[i].key}}]`;
  }
  return name;
}
