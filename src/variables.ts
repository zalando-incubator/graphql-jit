import { genFn } from "./generate.js";
import {
  type ConstValueNode,
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  type GraphQLInputObjectType,
  type GraphQLInputType,
  GraphQLInt,
  type GraphQLList,
  getNamedType,
  GraphQLSchema,
  GraphQLString,
  isEnumType,
  isInputObjectType,
  isInputType,
  isListType,
  isNonNullType,
  isScalarType,
  print,
  type OperationDefinitionNode,
  typeFromAST,
  type VariableDefinitionNode
} from "graphql";
import { computeLocations } from "./ast.js";
import { compileInputCopy, compileInputValue } from "./compile-input.js";
import { GraphQLError as GraphQLJITError } from "./error.js";
import {
  coerceConstLiteral,
  coerceInputValue,
  getDefaultValue,
  hasDefaultValue
} from "./compat.js";
import createInspect from "./inspect.js";
import { assertValidName } from "./validation.js";
import {
  appendSourceURL,
  createGeneratedSourceName,
  formatDebugSource,
  type CompilerDebugOptions
} from "./debug.js";

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
  dependencies: Map<string, unknown>;
  /**
   * Input object types are coerced by one hoisted function per type, which
   * makes recursive input types possible and keeps the generated code linear
   * in the number of types instead of the number of paths through them.
   */
  hoistedFunctions: Map<string, string>;
  /** Used to generate unique names for locals. */
  counter: number;
}

interface VariableCompilationDebugOptions {
  compilerOptions: CompilerDebugOptions;
  operation: OperationDefinitionNode;
}

/**
 * Every field below is a JS expression in the generated code.
 */
interface InputValue {
  type: GraphQLInputType;
  /** A local that holds the input value. */
  value: string;
  /** Where the coerced value is written to. */
  target: string;
  /**
   * The path of the value as a linked list of `{prev, key}`. Only evaluated on
   * errors and when descending into an input object, so it is cheap to pass
   * object literals here.
   */
  path: string;
  /** The name used in `Variable "$..."` error messages. */
  varName: string;
  /** Whether the value was provided. Only evaluated if the value is nullish. */
  hasValue: string;
  defaultValue: unknown | undefined;
  /**
   * The literal `defaultValue` was coerced from, for the default of a variable
   * definition. Unset for defaults from the schema.
   */
  defaultLiteral?: ConstValueNode;
  /** The message prefix for nested errors, unset for top level variables. */
  errorMessage?: string;
  /** The source locations of the variable definition. */
  loc: string;
}

export function compileVariableParsing(
  schema: GraphQLSchema,
  varDefNodes: ReadonlyArray<VariableDefinitionNode>,
  debug?: VariableCompilationDebugOptions
): (inputs: { [key: string]: any }) => CoercedVariableValues {
  const errors = [];
  const coercedValues: { [key: string]: any } = Object.create(null);
  const context: CompilationContext = {
    dependencies: new Map(),
    hoistedFunctions: new Map(),
    counter: 0
  };

  let constants = "";
  let mainBody = "";
  for (let i = 0; i < varDefNodes.length; i++) {
    const varDefNode = varDefNodes[i];
    const varName = varDefNode.variable.name.value;
    assertValidName(varName, "variable name");
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

    const key = JSON.stringify(varName);
    constants += `
      const __path${i} = { prev: undefined, key: ${key} };
      const __loc${i} = ${JSON.stringify(computeLocations([varDefNode]))};
    `;
    const value = `__variable${i}`;
    mainBody += `const ${value} = input[${key}];\n`;
    mainBody += generateInput(context, {
      type: varType,
      value,
      target: `coerced[${key}]`,
      path: `__path${i}`,
      varName: key,
      hasValue: `__hasOwn.call(input, ${key})`,
      defaultValue: varDefNode.defaultValue
        ? coerceConstLiteral(varDefNode.defaultValue, varType)
        : undefined,
      defaultLiteral: varDefNode.defaultValue,
      loc: `__loc${i}`
    });
  }

  if (errors.length > 0) {
    throw errors;
  }

  // Circular or extremely deep values of recursive input types exhaust the
  // stack; return that as an error like GraphQL.js instead of throwing.
  const gen = genFn();
  gen(`(function () {
    const __hasOwn = Object.prototype.hasOwnProperty;

    function __printPath(path) {
      let printed = "";
      for (let p = path; p.prev !== undefined; p = p.prev) {
        printed = (typeof p.key === "number" ? "[" + p.key + "]" : "." + p.key) + printed;
      }
      return "value" + printed;
    }

    ${constants}

    ${Array.from(context.hoistedFunctions.values()).join("\n")}

    return function getVariables(input) {
      try {
        const errors = [];
        const coerced = ${JSON.stringify(coercedValues)};
        ${mainBody}
        if (errors.length > 0) {
          return {errors, coerced: undefined};
        }
        return {errors: undefined, coerced};
      } catch (error) {
        return {
          errors: [
            error instanceof GraphQLJITError
              ? error
              : new GraphQLJITError(error.message, undefined, undefined, error)
          ],
          coerced: undefined
        };
      }
    };
  })()`);

  const functionExpression = gen.toString();
  const functionBody = debug
    ? "return " +
      formatDebugSource(
        functionExpression,
        debug.compilerOptions.formatSourceCode
      )
    : `
    return ${functionExpression}`;
  const generatedSource = debug
    ? appendSourceURL(
        functionBody,
        createGeneratedSourceName(
          debug.operation.name?.value,
          debug.compilerOptions,
          "variables"
        )
      )
    : functionBody;

  // eslint-disable-next-line
  return Function.apply(
    null,
    ["GraphQLJITError", "inspect"]
      .concat(Array.from(context.dependencies.keys()))
      .concat(generatedSource)
  ).apply(
    null,
    [GraphQLJITError, inspect as unknown].concat(
      Array.from(context.dependencies.values())
    )
  );
}

// Int Scalars represent 32 bits
// https://graphql.github.io/graphql-spec/June2018/#sec-Int
const MAX_32BIT_INT = 2147483647;
const MIN_32BIT_INT = -2147483648;

/**
 * Emits the statement that writes the default value of an input to its
 * target.
 *
 * Default values are internal values, so a custom scalar may use bigints,
 * dates or other values that cannot be written into source. Containers are
 * emitted inline, so every execution gets fresh ones, and opaque values are
 * bound as compiler dependencies.
 *
 * GraphQL-JS coerces the default literal of a variable definition for every
 * execution, while defaults from the schema are shared. When such a literal
 * holds a custom scalar that parses to an object, every execution gets a copy
 * of it, or coerces the literal again if the value cannot be copied, see
 * ScalarLiteral.
 */
function compileDefault(
  context: CompilationContext,
  input: InputValue,
  type: GraphQLInputType
): string {
  const { target, defaultValue, defaultLiteral } = input;
  const bind = (value: unknown) => {
    const name = `__default${context.dependencies.size}`;
    context.dependencies.set(name, value);
    return name;
  };
  if (defaultLiteral === undefined) {
    return `${target} = ${compileInputValue(defaultValue, type, bind)};`;
  }
  // returns undefined if the literal is invalid
  const coerce = () => coerceConstLiteral(defaultLiteral, type);
  const copy = compileInputCopy(defaultValue, coerce(), type, bind);
  if (copy !== undefined) {
    return `${target} = ${copy};`;
  }
  // The literal was valid when compiling, so coercing it can only fail if
  // parsing does not return the same result every time.
  const message = JSON.stringify(
    ` has invalid default value ${print(defaultLiteral)}.`
  );
  return `{
    const __coerced = ${bind(coerce)}();
    if (__coerced === undefined) {
      errors.push(new GraphQLJITError('Variable "$' + ${
        input.varName
      } + '"' + ${message}, ${input.loc}));
    } else {
      ${target} = __coerced;
    }
  }`;
}

function invalidValue(input: InputValue, message: string) {
  return `errors.push(new GraphQLJITError('Variable "$' + ${input.varName} + '" got invalid value ' +
    inspect(${input.value}) + "; " + ${message}, ${input.loc}));`;
}

function generateInput(context: CompilationContext, input: InputValue) {
  const { value, target, hasValue, defaultValue, loc } = input;
  let varType = input.type;
  const declaredType = varType;
  // Type names are written into the generated source, as part of
  // identifiers and string literals.
  assertValidName(getNamedType(varType).name, "type name");

  const gen = genFn();
  gen(`if (${value} == null) {`);

  if (isNonNullType(varType)) {
    let nonNullMessage;
    let omittedMessage;
    if (input.errorMessage) {
      const path = `__printPath(${input.path})`;
      nonNullMessage = `${input.errorMessage} + "Expected non-nullable type ${varType} not to be null at " + ${path} + "."`;
      omittedMessage = `${input.errorMessage} + "Field " + ${path} + " of required type ${varType} was not provided."`;
    } else {
      nonNullMessage = `'Variable "$' + ${input.varName} + '" of non-null type "${varType}" must not be null.'`;
      omittedMessage = `'Variable "$' + ${input.varName} + '" of required type "${varType}" was not provided.'`;
    }
    varType = varType.ofType;
    if (defaultValue !== undefined) {
      // A non-null input with a default is not required; only an explicit
      // null is an error.
      gen(`
        if (${hasValue}) {
          errors.push(new GraphQLJITError(${nonNullMessage}, ${loc}));
        } else {
          ${compileDefault(context, input, declaredType)}
        }
      `);
    } else {
      gen(`
        errors.push(new GraphQLJITError(${hasValue} ? ${nonNullMessage} : ${omittedMessage}, ${loc}));
      `);
    }
  } else {
    gen(`if (${hasValue}) { ${target} = null; }`);
    if (defaultValue !== undefined) {
      gen(`else { ${compileDefault(context, input, declaredType)} }`);
    }
  }
  gen(`} else {`);
  if (isScalarType(varType)) {
    const name = varType.name;
    switch (name) {
      case GraphQLID.name:
        gen(`
          if (typeof ${value} === "string") {
            ${target} = ${value};
          } else if (Number.isInteger(${value})) {
            ${target} = ${value}.toString();
          } else {
            ${invalidValue(
              input,
              `'Expected type ${name}; ${name} cannot represent value: ' + inspect(${value})`
            )}
          }
        `);
        break;
      case GraphQLString.name:
        gen(`
          if (typeof ${value} === "string") {
            ${target} = ${value};
          } else {
            ${invalidValue(
              input,
              `'Expected type ${name}; ${name} cannot represent a non string value: ' + inspect(${value})`
            )}
          }
        `);
        break;
      case GraphQLBoolean.name:
        gen(`
          if (typeof ${value} === "boolean") {
            ${target} = ${value};
          } else {
            ${invalidValue(
              input,
              `'Expected type ${name}; ${name} cannot represent a non boolean value: ' + inspect(${value})`
            )}
          }
        `);
        break;
      case GraphQLInt.name:
        gen(`
          if (Number.isInteger(${value})) {
            if (${value} > ${MAX_32BIT_INT} || ${value} < ${MIN_32BIT_INT}) {
              ${invalidValue(
                input,
                `'Expected type ${name}; ${name} cannot represent non 32-bit signed integer value: ' + inspect(${value})`
              )}
            } else {
              ${target} = ${value};
            }
          } else {
            ${invalidValue(
              input,
              `'Expected type ${name}; ${name} cannot represent non-integer value: ' + inspect(${value})`
            )}
          }
        `);
        break;
      case GraphQLFloat.name:
        gen(`
          if (Number.isFinite(${value})) {
            ${target} = ${value};
          } else {
            ${invalidValue(
              input,
              `'Expected type ${name}; ${name} cannot represent non numeric value: ' + inspect(${value})`
            )}
          }
        `);
        break;
      default: {
        const scalarType = varType;
        context.dependencies.set(`${name}parseValue`, (v: unknown) =>
          coerceInputValue(scalarType, v)
        );
        gen(`
          try {
            const parseResult = ${name}parseValue(${value});
            if (parseResult === undefined || parseResult !== parseResult) {
              ${invalidValue(input, `'Expected type ${name}.'`)}
            }
            ${target} = parseResult;
          } catch (error) {
            errors.push(new GraphQLJITError('Variable "$' + ${
              input.varName
            } + '" got invalid value ' +
              inspect(${value}) + "; " +
              'Expected type ${name}.', ${loc}, undefined, error)
            );
          }
        `);
      }
    }
  } else if (isEnumType(varType)) {
    const name = varType.name;
    context.dependencies.set(`${name}getValue`, varType.getValue.bind(varType));
    gen(`
      if (typeof ${value} === "string") {
        const enumValue = ${name}getValue(${value});
        if (enumValue) {
          ${target} = enumValue.value;
        } else {
          ${invalidValue(input, `'Expected type ${name}.'`)}
        }
      } else {
        ${invalidValue(input, `'Expected type ${name}.'`)}
      }
    `);
  } else if (isListType(varType)) {
    gen(generateListInput(context, varType, input));
  } else if (isInputObjectType(varType)) {
    const fn = hoistInputObjectParser(context, varType);
    gen(
      `${target} = ${fn}(${value}, ${input.varName}, ${input.path}, errors, ${loc});`
    );
  } else {
    /* istanbul ignore next line */
    throw new Error(`unknown type: ${varType}`);
  }
  gen(`}`);
  return gen.toString();
}

function generateListInput(
  context: CompilationContext,
  varType: GraphQLList<GraphQLInputType>,
  input: InputValue
) {
  const { value, target } = input;
  const id = context.counter++;
  const index = `__index${id}`;
  const item = `__item${id}`;
  const list = `__list${id}`;
  const errorMessage = `'Variable "$' + ${input.varName} + '" got invalid value ' + inspect(${value}) + '; '`;

  const gen = genFn();
  gen(`
    if (Array.isArray(${value})) {
    const ${list} = [];
    for (let ${index} = 0; ${index} < ${value}.length; ++${index}) {
      const ${item} = ${value}[${index}];
      ${generateInput(context, {
        type: varType.ofType,
        value: item,
        target: `${list}[${index}]`,
        path: `{ prev: ${input.path}, key: ${index} }`,
        varName: input.varName,
        hasValue: `${item} !== undefined`,
        defaultValue: undefined,
        errorMessage,
        loc: input.loc
      })}
    }
    ${target} = ${list};
  } else {`);
  gen(
    generateInput(context, {
      ...input,
      type: varType.ofType,
      defaultValue: undefined,
      errorMessage
    })
  );
  gen(`${target} = [${target}];`);
  gen(`}`);
  return gen.toString();
}

/**
 * Returns the name of a function that coerces a non null value of the given
 * input object type. The function is generated only once per type, also when
 * the type references itself.
 */
function hoistInputObjectParser(
  context: CompilationContext,
  varType: GraphQLInputObjectType
): string {
  const fnName = `__parse${varType.name}`;
  if (context.hoistedFunctions.has(fnName)) {
    return fnName;
  }
  // reserve the name before generating the body for recursive types
  context.hoistedFunctions.set(fnName, "");

  const errorMessage = `'Variable "$' + varName + '" got invalid value ' + inspect(v) + '; '`;
  const fields = Object.values(varType.getFields());

  const gen = genFn();
  gen(`
    function ${fnName}(v, varName, path, errors, loc) {
      if (typeof v !== "object") {
        errors.push(new GraphQLJITError(${errorMessage} +
          'Expected type ${varType.name} to be an object.', loc));
        return;
      }
      const out = {};
  `);
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const key = JSON.stringify(field.name);
    const value = `__field${i}`;
    gen(`const ${value} = v[${key}];`);
    gen(
      generateInput(context, {
        type: field.type,
        value,
        target: `out[${key}]`,
        path: `{ prev: path, key: ${key} }`,
        varName: key,
        hasValue: `__hasOwn.call(v, ${key})`,
        defaultValue: hasDefaultValue(field)
          ? getDefaultValue(field)
          : undefined,
        errorMessage,
        loc: "loc"
      })
    );
  }

  const isUnknownField = fields
    .map((f) => `k !== ${JSON.stringify(f.name)}`)
    .join(" && ");
  gen(`
    for (const k in v) {
      if (${isUnknownField} && __hasOwn.call(v, k)) {
        errors.push(new GraphQLJITError(${errorMessage} +
          'Field "' + k + '" is not defined by type ${varType.name}.', loc));
        break;
      }
    }
  `);
  gen(`return out;`);
  gen(`}`);

  context.hoistedFunctions.set(fnName, gen.toString());
  return fnName;
}
