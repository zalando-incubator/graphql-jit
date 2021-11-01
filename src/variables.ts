import genFn from "generate-function";
import {
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLSchema,
  GraphQLString,
  isEnumType,
  isInputObjectType,
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
import { addPath, computeLocations, flattenPath, ObjectPath } from "./ast";
import { GraphQLError as GraphQLJITError } from "./error";
import createInspect from "./inspect";

const inspect = createInspect();

export type CoercedVariableValues = FailedVariableCoercion | VariableValues;

interface FailedVariableCoercion {
  errors: ReadonlyArray<GraphQLError>;
}

interface VariableValues {
  coerced: { [key: string]: any };
}

export function failToParseVariables(x: any): x is FailedVariableCoercion {
  return x.errors;
}

export interface VariablesCompilerOptions {
  /**
   * If true, the generated code for variables compilation validates
   * that there are no circular references (at runtime). For most cases,
   * the variables are the result of JSON.parse and in these cases, we
   * do not need this. Enable this if the variables passed to the execute
   * function may contain circular references.
   *
   * When enabled, the code checks for circular references in the
   * variables input, and throws an error when found.
   *
   * Default: false (set in execution.ts)
   */
  variablesCircularReferenceCheck: boolean;
}

interface CompilationContext {
  options: VariablesCompilerOptions;
  inputPath: ObjectPath;
  responsePath: ObjectPath;
  depth: number;
  varDefNode: VariableDefinitionNode;
  dependencies: Map<string, (...args: any[]) => any>;
  errorMessage?: string;
  hoistedFunctions: Map<string, string>;
}

function createSubCompilationContext(
  context: CompilationContext
): CompilationContext {
  return { ...context };
}

export function compileVariableParsing(
  schema: GraphQLSchema,
  options: VariablesCompilerOptions,
  varDefNodes: ReadonlyArray<VariableDefinitionNode>
): (inputs: { [key: string]: any }) => CoercedVariableValues {
  const errors = [];
  const coercedValues: { [key: string]: any } = Object.create(null);

  let mainBody = "";
  const dependencies = new Map();
  const hoistedFunctions = new Map();
  for (const varDefNode of varDefNodes) {
    const context: CompilationContext = {
      options,
      varDefNode,
      depth: 0,
      inputPath: addPath(undefined, "input"),
      responsePath: addPath(undefined, "coerced"),
      dependencies,
      hoistedFunctions
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
              varType ? varType : print(varDefNode.type)
            }" which cannot be used as an input type.`,
          computeLocations([varDefNode.type])
        )
      );
      continue;
    }
    if (varDefNode.defaultValue) {
      // If no value was provided to a variable with a default value,
      // use the default value.
      coercedValues[varName] = valueFromAST(varDefNode.defaultValue, varType);
    }

    const hasValueName = hasValue(addPath(context.inputPath, varName));
    mainBody += `const ${hasValueName} = Object.prototype.hasOwnProperty.call(${getObjectPath(
      context.inputPath
    )}, "${varName}");\n`;
    context.inputPath = addPath(context.inputPath, varName);
    context.responsePath = addPath(context.responsePath, varName);
    mainBody += generateInput({
      context,
      varType,
      varName,
      hasValueName,
      wrapInList: false,
      useInputPath: false,
      useResponsePath: false
    });
  }

  if (errors.length > 0) {
    throw errors;
  }

  const gen = genFn();
  gen(`
    const visitedInputValues = new Set();

    function getPath(o, path) {
      let current = o;
      for (const part of path) {
        current = current[part];
      }
      return current;
    }

    function setPath(o, path, value) {
      let current = o;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;
    }

    function isObjectLike(o) {
      return o != null && typeof o === "object";
    }

    ${Array.from(hoistedFunctions)
      .map(([, value]) => value)
      .join("\n")}

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

  const generatedFn = gen.toString();

  return Function.apply(
    null,
    ["GraphQLJITError", "inspect"]
      .concat(Array.from(dependencies.keys()))
      .concat(generatedFn)
  ).apply(
    null,
    [GraphQLJITError, inspect].concat(Array.from(dependencies.values()))
  );
}

// Int Scalars represent 32 bits
// https://graphql.github.io/graphql-spec/June2018/#sec-Int
const MAX_32BIT_INT = 2147483647;
const MIN_32BIT_INT = -2147483648;

interface GenerateInputParams {
  context: CompilationContext;
  varType: GraphQLInputType;
  varName: string;
  hasValueName: string;
  wrapInList: boolean;
  useInputPath: boolean;
  useResponsePath: boolean;
}

function generateInput({
  context,
  varType,
  varName,
  hasValueName,
  wrapInList,
  useInputPath,
  useResponsePath
}: GenerateInputParams) {
  const currentOutput = getObjectPath(context.responsePath);
  const responsePath = useResponsePath
    ? "responsePath"
    : pathToExpression(context.responsePath);
  const currentInput = useInputPath
    ? `getPath(input, inputPath)`
    : getObjectPath(context.inputPath);
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
      if (${hasValueName}) { setPath(coerced, ${responsePath}, null); }
    `);
  }
  gen(`} else {`);
  if (isScalarType(varType)) {
    switch (varType.name) {
      case GraphQLID.name:
        gen(`
          if (typeof ${currentInput} === "string") {
            setPath(coerced, ${responsePath}, ${currentInput});
          } else if (Number.isInteger(${currentInput})) {
            setPath(coerced, ${responsePath}, ${currentInput}.toString());
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
            setPath(coerced, ${responsePath}, ${currentInput});
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
          setPath(coerced, ${responsePath}, ${currentInput});
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
            setPath(coerced, ${responsePath}, ${currentInput});
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
          setPath(coerced, ${responsePath}, ${currentInput});
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
            setPath(coerced, ${responsePath}, parseResult);
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
          setPath(coerced, ${responsePath}, enumValue.value);
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
    gen(
      compileInputListType(
        context,
        varType,
        varName,
        useInputPath,
        useResponsePath
      )
    );
  } else if (isInputObjectType(varType)) {
    gen(
      compileInputObjectType(
        context,
        varType,
        varName,
        useInputPath,
        useResponsePath
      )
    );
  } else {
    /* istanbul ignore next line */
    throw new Error(`unknown type: ${varType}`);
  }
  if (wrapInList) {
    gen(
      `setPath(coerced, ${responsePath}, [getPath(coerced, ${responsePath})]);`
    );
  }
  gen(`}`);
  return gen.toString();
}

function compileInputListType(
  context: CompilationContext,
  varType: GraphQLList<GraphQLInputType>,
  varName: string,
  useInputPath: boolean,
  useResponsePath: boolean
) {
  const inputPath = useInputPath
    ? `inputPath`
    : pathToExpression(context.inputPath);
  const responsePath = useResponsePath
    ? "responsePath"
    : pathToExpression(context.responsePath);
  const currentInput = useInputPath
    ? `getPath(input, inputPath)`
    : getObjectPath(context.inputPath);
  const errorLocation = printErrorLocation(
    computeLocations([context.varDefNode])
  );

  const gen = genFn();

  context.errorMessage = `'Variable "$${varName}" got invalid value ' + inspect(${currentInput}) + '; '`;
  const hasValueName = hasValue(context.inputPath);
  const index = `idx${context.depth}`;

  const subContext = createSubCompilationContext(context);
  subContext.responsePath = addPath(subContext.responsePath, index, "variable");
  subContext.inputPath = addPath(subContext.inputPath, index, "variable");
  subContext.depth++;

  gen(`
    if (Array.isArray(${currentInput})) {
      setPath(coerced, ${responsePath}, []);
      const previousInputPath = ${inputPath};
      const previousResponsePath = ${responsePath};
      for (let ${index} = 0; ${index} < ${currentInput}.length; ++${index}) {
        const inputPath = previousInputPath.concat(${index});
        const responsePath = previousResponsePath.concat(${index});

        const __inputListValue = getPath(input, inputPath);

        ${generateCircularReferenceCheck(
          context,
          "__inputListValue",
          "inputPath",
          errorLocation,
          false
        )}

        const ${hasValueName} = __inputListValue !== undefined;

        ${generateInput({
          context: subContext,
          varType: varType.ofType,
          varName,
          hasValueName,
          wrapInList: false,
          useInputPath,
          useResponsePath
        })}
      }
    } else {
      ${generateInput({
        context,
        varType: varType.ofType,
        varName,
        hasValueName,
        wrapInList: true,
        useInputPath,
        useResponsePath
      })}
    }
  `);

  return gen.toString();
}

function compileInputObjectType(
  context: CompilationContext,
  varType: GraphQLInputObjectType,
  varName: string,
  useInputPath: boolean,
  useResponsePath: boolean
) {
  const responsePath = useResponsePath
    ? "responsePath"
    : pathToExpression(context.responsePath);
  const currentInput = useInputPath
    ? `getPath(input, inputPath)`
    : getObjectPath(context.inputPath);
  const errorLocation = printErrorLocation(
    computeLocations([context.varDefNode])
  );

  const gen = genFn();

  gen(`
    if (typeof ${currentInput} !== 'object') {
      errors.push(new GraphQLJITError('Variable "$${varName}" got invalid value ' +
      inspect(${currentInput}) + "; " +
      'Expected type ${varType.name} to be an object.', ${errorLocation}));
    } else {
      setPath(coerced, ${responsePath}, {});
  `);

  const fields = varType.getFields();
  const allowedFields = [];
  for (const field of Object.values(fields)) {
    const subContext = createSubCompilationContext(context);
    allowedFields.push(field.name);
    const hasValueName = hasValue(addPath(subContext.inputPath, field.name));

    gen(`
      const ${hasValueName} = Object.prototype.hasOwnProperty.call(
        ${currentInput}, "${field.name}"
      );
    `);

    subContext.inputPath = addPath(subContext.inputPath, field.name);
    subContext.responsePath = addPath(subContext.responsePath, field.name);
    subContext.errorMessage = `'Variable "$${varName}" got invalid value ' + inspect(${currentInput}) + '; '`;

    const varTypeParserName = "__fieldParser" + varType.name + field.name;

    const nextInputPath = useInputPath
      ? `inputPath.concat("${field.name}")`
      : pathToExpression(subContext.inputPath);

    const nextResponsePath = useResponsePath
      ? `responsePath.concat("${field.name}")`
      : pathToExpression(subContext.responsePath);

    gen(`
      ${varTypeParserName}(
        input,
        ${nextInputPath},
        coerced,
        ${nextResponsePath},
        errors,
        ${hasValueName}
      );
    `);

    if (!context.hoistedFunctions.has(varTypeParserName)) {
      context.hoistedFunctions.set(varTypeParserName, "");
      context.hoistedFunctions.set(
        varTypeParserName,
        `
          function ${varTypeParserName} (
            input,
            inputPath,
            coerced,
            responsePath,
            errors,
            ${hasValueName}
          ) {
            const __inputValue = getPath(input, inputPath);

            ${generateCircularReferenceCheck(
              context,
              "__inputValue",
              "inputPath",
              errorLocation,
              true
            )}

            ${generateInput({
              context: subContext,
              varType: field.type,
              varName: field.name,
              hasValueName,
              wrapInList: false,
              useInputPath: true,
              useResponsePath: true
            })}
          }
        `
      );
    }
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
  `);

  gen(`}`);

  return gen.toString();
}

function generateCircularReferenceCheck(
  context: CompilationContext,
  inputValueName: string,
  inputPathName: string,
  errorLocation: string,
  shouldReturn: boolean
) {
  /**
   * If the variablesCircularReferenceCheck is `false`, do not generate
   * code to verify circular references.
   */
  if (!context.options.variablesCircularReferenceCheck) {
    return "";
  }

  const gen = genFn();
  gen(`if (visitedInputValues.has(${inputValueName})) {`);
  gen(`
    errors.push(
      new GraphQLJITError(
        "Circular reference detected in input variable '$"
          + ${inputPathName}[0]
          + "' at "
          + ${inputPathName}.slice(1).join("."),
        [${errorLocation}]
      )
    );
  `);

  if (shouldReturn) {
    gen(`return;`);
  }

  gen(`}`);
  gen(`
    if (isObjectLike(${inputValueName})) {
      visitedInputValues.add(${inputValueName});
    }
  `);

  return gen.toString();
}

function pathToExpression(path: ObjectPath) {
  const expr = flattenPath(path)
    // object access pattern - flatten returns in reverse order from leaf to root
    .reverse()
    // remove the variable name (input/coerced - are the cases in this file)
    .slice(1)
    // serialize
    .map(({ key, type }) => (type === "literal" ? `"${key}"` : key))
    .join(",");

  return `[${expr}]`;
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
