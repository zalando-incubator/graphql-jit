import fastJson from "fast-json-stringify";
import {
  ASTNode,
  DocumentNode,
  ExecutionResult,
  FragmentDefinitionNode,
  getOperationRootType,
  GraphQLAbstractType,
  GraphQLEnumType,
  GraphQLError,
  GraphQLLeafType,
  GraphQLList,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLScalarSerializer,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLType,
  isAbstractType,
  isLeafType,
  isListType,
  isNonNullType,
  isObjectType,
  isSpecifiedScalarType,
  Kind,
  print
} from "graphql";
import { collectFields, ExecutionContext } from "graphql/execution/execute";
import { CoercedVariableValues } from "graphql/execution/values";
import { FieldNode, OperationDefinitionNode } from "graphql/language/ast";
import Maybe from "graphql/tsutils/Maybe";
import { GraphQLTypeResolver } from "graphql/type/definition";
import {
  addPath,
  Arguments,
  collectSubfields,
  computeLocations,
  flattenPath,
  getArgumentDefs,
  ObjectPath,
  resolveFieldDef
} from "./ast";
import { GraphQLError as GraphqlJitError } from "./error";
import createInspect from "./inspect";
import { queryToJSONSchema } from "./json";
import { createNullTrimmer, NullTrimmer } from "./non-null";
import {
  createResolveInfoThunk,
  ResolveInfoEnricherInput
} from "./resolve-info";
import { compileVariableParsing } from "./variables";

const inspect = createInspect();

export interface CompilerOptions {
  customJSONSerializer: boolean;

  // Disable builtin scalars and enum serialization
  // which is responsible for coercion,
  // only safe for use if the output is completely correct.
  disableLeafSerialization: boolean;

  // Disable capturing the stack trace of errors.
  disablingCapturingStackErrors: boolean;

  // Map of serializers to override
  // the key should be the name passed to the Scalar or Enum type
  customSerializers: { [key: string]: (v: any) => any };

  resolverInfoEnricher?: (inp: ResolveInfoEnricherInput) => object;
}

/**
 * The context used during compilation.
 *
 * It stores deferred nodes to be processed later as well as the function arguments to be bounded at top level
 */
interface CompilationContext extends ExecutionContext {
  dependencies: Map<string, (...args: any[]) => any>;
  deferred: DeferredField[];
  options: CompilerOptions;
  depth: number;
}

// prefix for the variable used ot cache validation results
const SAFETY_CHECK_PREFIX = "__validNode";
const GLOBAL_DATA_NAME = "__globalData";
const GLOBAL_ERRORS_NAME = "__globalErrors";
const GLOBAL_NULL_ERRORS_NAME = "__globalNullErrors";
const GLOBAL_EXECUTOR_NAME = "__executor";
const GLOBAL_ROOT_NAME = "__rootValue";
const GLOBAL_VARIABLES_NAME = "__variables";
const GLOBAL_CONTEXT_NAME = "__context";

interface DeferredField {
  name: string;
  responsePath: ObjectPath;
  originPaths: string[];
  destinationPaths: string[];
  parentType: GraphQLObjectType;
  fieldName: string;
  fieldType: GraphQLOutputType;
  fieldNodes: FieldNode[];
  args: Arguments;
}

export type Callback = (d: object | null, e: Error | null) => void;

export type JITCallback = (
  p: object,
  d: object | null,
  e: Error | null
) => void;

export interface CompiledQuery {
  operationName?: string;
  query: (
    root: any,
    context: any,
    variables: Maybe<{ [key: string]: GraphQLScalarSerializer<any> }>
  ) => Promise<ExecutionResult> | ExecutionResult;
  stringify: (v: any) => string;
}

/**
 * It compiles a GraphQL query to an executable function
 * @param {GraphQLSchema} schema GraphQL schema
 * @param {DocumentNode} document Query being submitted
 * @param {string} operationName name of the operation
 * @param partialOptions compilation options to tune the compiler features
 * @returns {CompiledQuery} the cacheable result
 */
export function compileQuery(
  schema: GraphQLSchema,
  document: DocumentNode,
  operationName?: string,
  partialOptions?: Partial<CompilerOptions>
): CompiledQuery | ExecutionResult {
  if (!schema) {
    throw new Error(`Expected ${schema} to be a GraphQL schema.`);
  }
  if (!document) {
    throw new Error("Must provide document");
  }

  if (
    partialOptions &&
    partialOptions.resolverInfoEnricher &&
    typeof partialOptions.resolverInfoEnricher !== "function"
  ) {
    throw new Error("resolverInfoEnricher must be a function");
  }
  try {
    const options = {
      disablingCapturingStackErrors: false,
      customJSONSerializer: false,
      disableLeafSerialization: false,
      customSerializers: {},
      ...partialOptions
    };

    // If a valid context cannot be created due to incorrect arguments,
    // a "Response" with only errors is returned.
    const context = buildCompilationContext(
      schema,
      document,
      options,
      operationName
    );

    let stringify: (v: any) => string;
    if (options.customJSONSerializer) {
      const jsonSchema = queryToJSONSchema(context);
      stringify = fastJson(jsonSchema);
    } else {
      stringify = JSON.stringify;
    }
    const getVariables = compileVariableParsing(
      schema,
      context.operation.variableDefinitions || []
    );

    const mainBody = compileOperation(context);
    const functionBody = `
  ${getFunctionSignature(context)} {
  ${functionHeader}
  ${mainBody}
  ${functionFooter}
  }`;
    const func = new Function(functionBody)();
    return {
      query: createBoundQuery(context, document, func, getVariables),
      stringify
    };
  } catch (err) {
    return {
      errors: normalizeErrors(err)
    };
  }
}

export function isCompiledQuery<
  C extends CompiledQuery,
  E extends ExecutionResult
>(query: C | E): query is C {
  return "query" in query && typeof query.query === "function";
}

// Exported only for an error test
export function createBoundQuery(
  compilationContext: CompilationContext,
  document: DocumentNode,
  func: (...args: any[]) => any,
  getVariableValues: (inputs: { [key: string]: any }) => CoercedVariableValues
) {
  const {
    operation: { operation }
  } = compilationContext;
  const trimmer = createNullTrimmer(compilationContext);
  const resolvers = getFunctionResolvers(compilationContext);
  return (
    rootValue: any,
    context: any,
    variables: Maybe<{ [key: string]: any }>
  ): Promise<ExecutionResult> | ExecutionResult => {
    // this can be shared across in a batch request
    const { errors, coerced } = getVariableValues(variables || {});

    // Return early errors if variable coercing failed.
    if (errors) {
      return { errors };
    }

    let result: ExecutionResult | null = null;
    const maybePromise: {
      resolve: (r: ExecutionResult) => void;
      reject: (e: Error) => void;
    } = {
      resolve: (r: ExecutionResult) => {
        result = r;
      },
      reject: (err: Error) => {
        throw err;
      }
    };
    const callback = (
      data: any,
      errors: GraphQLError[],
      nullErrors: GraphQLError[]
    ) => {
      if (result) {
        throw new Error("called the final cb more than once");
      }
      maybePromise.resolve(
        postProcessResult(trimmer, data, errors, nullErrors)
      );
    };
    const globalErrorHandler = (err: Error) => {
      // Logging the culprit
      // tslint:disable-next-line
      console.error(`bad function: ${func.toString()}`);
      // tslint:disable-next-line
      console.error(`good query: ${print(document)}`);
      maybePromise.reject(err);
    };
    let executor;
    let resolveIfDone;
    if (operation === "mutation") {
      const serial = serialPromiseExecutor(callback, globalErrorHandler);
      executor = serial.addToQueue;
      resolveIfDone = serial.startExecution;
    } else {
      const loose = loosePromiseExecutor(callback, globalErrorHandler);
      executor = loose.executor;
      resolveIfDone = loose.resolveIfDone;
    }
    func.apply(null, [
      rootValue,
      context,
      coerced,
      executor,
      resolveIfDone,
      safeMap,
      GraphqlJitError,
      ...resolvers
    ]);
    if (result) {
      return result;
    }
    return new Promise((resolve, reject) => {
      maybePromise.resolve = resolve;
      maybePromise.reject = reject;
    });
  };
}

function postProcessResult(
  trimmer: NullTrimmer,
  data: any,
  errors: GraphQLError[],
  nullErrors: GraphQLError[]
) {
  if (nullErrors.length > 0) {
    const trimmed = trimmer(data, nullErrors);
    return {
      data: trimmed.data,
      errors: errors.concat(trimmed.errors)
    };
  } else if (errors.length > 0) {
    return {
      data,
      errors
    };
  }
  return { data };
}

/**
 * Create the main function body.
 *
 * Implements the "Evaluating operations" section of the spec.
 *
 * It defers all top level field for consistency and protection for null root values,
 * all the fields are deferred regardless of presence of resolver or not.
 *
 * @param {CompilationContext} context compilation context with the execution context
 * @returns {string} a function body to be instantiated together with the header, footer
 */
function compileOperation(context: CompilationContext) {
  const type = getOperationRootType(context.schema, context.operation);
  const fieldMap = collectFields(
    context,
    type,
    context.operation.selectionSet,
    Object.create(null),
    Object.create(null)
  );
  const topLevel = compileObjectType(
    context,
    type,
    [GLOBAL_ROOT_NAME],
    [GLOBAL_DATA_NAME],
    undefined,
    fieldMap,
    true
  );
  let body = generateUniqueDeclarations(context, true);
  body += `const ${GLOBAL_DATA_NAME} = ${topLevel}\n`;
  body += compileDeferredFields(context);
  return body;
}

/**
 * Processes the deferred node list in the compilation context.
 *
 * Each deferred node get a copy of the compilation context with
 * a new empty list for deferred nodes to properly scope the nodes.
 * @param {CompilationContext} context compilation context
 * @returns {string} compiled transformations all of deferred nodes
 */
function compileDeferredFields(context: CompilationContext): string {
  let body = "";
  context.deferred.forEach(
    (
      {
        name,
        originPaths,
        destinationPaths,
        fieldNodes,
        fieldType,
        fieldName,
        responsePath,
        parentType,
        args
      },
      index
    ) => {
      const subContext = createSubCompilationContext(context);
      const nodeBody = compileType(
        subContext,
        parentType,
        fieldType,
        fieldNodes,
        [fieldName],
        [`parent.${name}`],
        responsePath
      );
      const resolverName = getResolverName(parentType.name, fieldName);
      const topLevelArgs = getArgumentsVarName(resolverName);
      const validArgs = getValidArgumentsVarName(resolverName);
      body += `
  if (${SAFETY_CHECK_PREFIX}${index}) {
   ${getArguments(
     subContext,
     args,
     topLevelArgs,
     validArgs,
     fieldType,
     responsePath
   )}
   if (${validArgs} === true) {
     ${GLOBAL_EXECUTOR_NAME}(() => ${resolverName}(
     ${originPaths.join(".")},
     ${topLevelArgs},
     ${GLOBAL_CONTEXT_NAME},
     ${getExecutionInfo(
       subContext,
       parentType,
       fieldType,
       fieldName,
       fieldNodes,
       responsePath
     )}),
     (parent, ${fieldName}, err) => {
      if (err != null) {
          ${
            isNonNullType(fieldType)
              ? GLOBAL_NULL_ERRORS_NAME
              : GLOBAL_ERRORS_NAME
          }.push(${
        createErrorObject(
          context,
          fieldNodes,
          responsePath,
          "err.message != null ? err.message : err",
          "err"
        ) /* TODO: test why no return here*/
      });
      }
      ${generateUniqueDeclarations(subContext)}
      parent.${name} = ${nodeBody};\n
      ${compileDeferredFields(subContext)}
    },${destinationPaths.join(
      "."
    )}, ${GLOBAL_DATA_NAME}, ${GLOBAL_ERRORS_NAME}, ${GLOBAL_NULL_ERRORS_NAME})
    }
  }`;
    }
  );
  return body;
}

/**
 * Processes a generic node.
 *
 * The type is analysed and later reprocessed in dedicated functions.
 * @param {CompilationContext} context compilation context to hold deferred nodes
 * @param parentType
 * @param {GraphQLType} type type of current parent node
 * @param {FieldNode[]} fieldNodes array of the field nodes
 * @param originPaths originPaths path in the parent object from where to fetch results
 * @param destinationPaths path in the where to write the result
 * @param previousPath response path until this node
 * @returns {string} body of the resolvable fieldNodes
 */
function compileType(
  context: CompilationContext,
  parentType: GraphQLObjectType,
  type: GraphQLType,
  fieldNodes: FieldNode[],
  originPaths: string[],
  destinationPaths: string[],
  previousPath: ObjectPath
): string {
  const sourcePath = originPaths.join(".");
  let body = `${sourcePath} == null ? `;
  let errorDestination;
  if (isNonNullType(type)) {
    type = type.ofType;
    const nullErrorStr = `"Cannot return null for non-nullable field ${
      parentType.name
    }.${getFieldNodesName(fieldNodes)}."`;
    body += `(${GLOBAL_NULL_ERRORS_NAME}.push(${createErrorObject(
      context,
      fieldNodes,
      previousPath,
      nullErrorStr
    )}), null) :`;
    errorDestination = GLOBAL_NULL_ERRORS_NAME;
  } else {
    body += "null : ";
    errorDestination = GLOBAL_ERRORS_NAME;
  }
  body += "(";
  // value can be an error obj
  const errorPath = `${sourcePath}.message != null ? ${sourcePath}.message : ${sourcePath}`;
  body += `${sourcePath} instanceof Error ? (${errorDestination}.push(${createErrorObject(
    context,
    fieldNodes,
    previousPath,
    errorPath,
    sourcePath
  )}), null) : `;

  if (isLeafType(type)) {
    body += compileLeafType(
      context,
      type,
      originPaths,
      fieldNodes,
      previousPath,
      errorDestination
    );
  } else if (isObjectType(type)) {
    const fieldMap = collectSubfields(context, type, fieldNodes);
    body += compileObjectType(
      context,
      type,
      originPaths,
      destinationPaths,
      previousPath,
      fieldMap,
      false
    );
  } else if (isAbstractType(type)) {
    body += compileAbstractType(
      context,
      parentType,
      type,
      fieldNodes,
      originPaths,
      previousPath,
      errorDestination
    );
  } else if (isListType(type)) {
    body += compileListType(
      context,
      parentType,
      type,
      fieldNodes,
      originPaths,
      previousPath,
      errorDestination
    );
  } else {
    /* istanbul ignore next */
    throw new Error(`unsupported type: ${type.toString()}`);
  }
  body += ")";
  return body;
}

function compileLeafType(
  context: CompilationContext,
  type: GraphQLLeafType,
  originPaths: string[],
  fieldNodes: FieldNode[],
  previousPath: ObjectPath,
  errorDestination: string
) {
  let body = "";
  if (
    context.options.disableLeafSerialization &&
    (type instanceof GraphQLEnumType || isSpecifiedScalarType(type))
  ) {
    body += `${originPaths.join(".")}`;
  } else {
    context.dependencies.set(
      getSerializerName(type.name),
      getSerializer(type, context.options.customSerializers[type.name])
    );
    body += getSerializerName(type.name);
    body += `(${originPaths.join(
      "."
    )}, (message) => {${errorDestination}.push(${createErrorObject(
      context,
      fieldNodes,
      previousPath,
      "message"
    )});})`;
  }
  return body;
}

/**
 * Compile a node of object type.
 * @param {CompilationContext} context
 * @param {GraphQLObjectType} type type of the node
 * @param originPaths originPaths path in the parent object from where to fetch results
 * @param destinationPaths path in the where to write the result
 * @param responsePath response path until this node
 * @param fieldMap fieldNodes array with the nodes references
 * @param alwaysDefer used to force the field to be resolved with a resolver ala graphql-js
 * @returns {string}
 */
function compileObjectType(
  context: CompilationContext,
  type: GraphQLObjectType,
  originPaths: string[],
  destinationPaths: string[],
  responsePath: ObjectPath | undefined,
  fieldMap: { [key: string]: FieldNode[] },
  alwaysDefer: boolean
): string {
  let body = `{`;
  for (const name of Object.keys(fieldMap)) {
    const fieldNodes = fieldMap[name];
    const field = resolveFieldDef(context, type, fieldNodes);
    if (!field) {
      // Field is invalid, should have been caught in validation
      // but the error is swallowed for compatibility reasons.
      continue;
    }
    // Name is the field name or an alias supplied by the user
    body += `${name}: `;

    let resolver = field.resolve;
    if (!resolver && alwaysDefer) {
      const fieldName = field.name;
      resolver = parent => parent && parent[fieldName];
    }
    if (resolver) {
      context.deferred.push({
        name,
        responsePath: addPath(responsePath, name),
        originPaths,
        destinationPaths,
        parentType: type,
        fieldName: field.name,
        fieldType: field.type,
        fieldNodes,
        args: getArgumentDefs(field, fieldNodes[0])
      });
      context.dependencies.set(
        getResolverName(type.name, field.name),
        resolver
      );
      body += `(${SAFETY_CHECK_PREFIX}${context.deferred.length -
        1} = true, null)`;
    } else {
      body += compileType(
        context,
        type,
        field.type,
        fieldNodes,
        originPaths.concat(field.name),
        destinationPaths.concat(name),
        addPath(responsePath, name)
      );
    }
    body += ",";
  }
  body += "}";
  return body;
}

function compileAbstractType(
  context: CompilationContext,
  parentType: GraphQLObjectType,
  type: GraphQLAbstractType,
  fieldNodes: FieldNode[],
  originPaths: string[],
  previousPath: ObjectPath,
  errorDestination: string
): string {
  let resolveType: GraphQLTypeResolver<any, any>;
  if (type.resolveType) {
    resolveType = type.resolveType;
  } else {
    resolveType = (value: any, context: any, info: GraphQLResolveInfo) =>
      defaultResolveTypeFn(value, context, info, type);
  }
  context.dependencies.set(getTypeResolverName(type.name), resolveType);
  const collectedTypes = context.schema
    .getPossibleTypes(type)
    .map(objectType => {
      const subContext = createSubCompilationContext(context);
      const object = compileType(
        subContext,
        parentType,
        objectType,
        fieldNodes,
        originPaths,
        ["__concrete"],
        addPath(previousPath, objectType.name, "meta")
      );
      return `case "${objectType.name}": {
                  ${generateUniqueDeclarations(subContext)}
                  const __concrete = ${object};
                  ${compileDeferredFields(subContext)}
                  return __concrete;
              }`;
    })
    .join("\n");
  const finalTypeName = "finalType";
  const nullTypeError = `"Runtime Object type is not a possible type for \\"${
    type.name
  }\\"."`;
  // tslint:disable:max-line-length
  const notPossibleTypeError =
    '`Runtime Object type "${nodeType}" is not a possible type for "' +
    type.name +
    '".`';
  const noTypeError = `${finalTypeName} ? ${notPossibleTypeError} : "Abstract type ${
    type.name
  } must resolve to an Object type at runtime for field ${
    parentType.name
  }.${getFieldNodesName(fieldNodes)}. Either the ${
    type.name
  } type should provide a \\"resolveType\\" function or each possible types should provide an \\"isTypeOf\\" function."`;
  // tslint:enable:max-line-length
  return `((nodeType, err) =>
  {
    if (err != null) {
      ${errorDestination}.push(${createErrorObject(
    context,
    fieldNodes,
    previousPath,
    "err.message != null ? err.message : err",
    "err"
  )});
      return null;
    }
    if (nodeType == null) {
      ${errorDestination}.push(${createErrorObject(
    context,
    fieldNodes,
    previousPath,
    nullTypeError
  )})
      return null;
    }
    const ${finalTypeName} = typeof nodeType === "string" ? nodeType : nodeType.name;
    switch(${finalTypeName}) {
      ${collectedTypes}
      default:
      ${errorDestination}.push(${createErrorObject(
    context,
    fieldNodes,
    previousPath,
    noTypeError
  )})
      return null;
    }
  })(
    ${getTypeResolverName(type.name)}(${originPaths.join(".")},
    __context,
    ${getExecutionInfo(
      context,
      parentType,
      type,
      type.name,
      fieldNodes,
      previousPath
    )}))`;
}

/**
 * Compile a list transformation.
 *
 * @param {CompilationContext} context
 * @param {GraphQLObjectType} parentType type of the parent of object which contained this type
 * @param {GraphQLList<GraphQLType>} type list type being compiled
 * @param {FieldNode[]} fieldNodes
 * @param originalObjectPaths
 * @param {ObjectPath} responsePath
 * @param errorDestination
 * @returns {string} compiled list transformation
 */
function compileListType(
  context: CompilationContext,
  parentType: GraphQLObjectType,
  type: GraphQLList<GraphQLType>,
  fieldNodes: FieldNode[],
  originalObjectPaths: string[],
  responsePath: ObjectPath,
  errorDestination: string
) {
  const name = originalObjectPaths.join(".");
  const listContext = createSubCompilationContext(context);
  // context depth will be mutated, so we cache the current value.
  const newDepth = ++listContext.depth;
  const dataBody = compileType(
    listContext,
    parentType,
    type.ofType,
    fieldNodes,
    ["__safeMapNode"],
    ["__child"],
    addPath(responsePath, "idx" + newDepth, "variable")
  );

  const errorMessage = `"Expected Iterable, but did not find one for field ${
    parentType.name
  }.${getFieldNodesName(fieldNodes)}."`;
  const errorCase = `(${errorDestination}.push(${createErrorObject(
    context,
    fieldNodes,
    responsePath,
    errorMessage
  )}), null)`;
  return `(typeof ${name} === "string" || typeof ${name}[Symbol.iterator] !== "function") ?  ${errorCase} :
  __safeMap(${name}, (__safeMapNode, idx${newDepth}) => {
     ${generateUniqueDeclarations(listContext)}
     const __child = ${dataBody};
     ${compileDeferredFields(listContext)}
     return __child;
    })`;
}

/**
 * Converts a promise to a callbackable interface
 * @param valueGen a function that can return a promise or an value
 * @param {Callback} cb callback to be called with the result, the cb should only called once
 * @param errorHandler handler for unexpected errors caused by bugs
 */
function unpromisify(
  valueGen: () => Promise<any> | any,
  cb: Callback,
  errorHandler: (err: Error) => void
): void {
  let value: any;
  try {
    value = valueGen();
  } catch (e) {
    cb(null, e);
    return;
  }

  if (isPromise(value)) {
    value
      .then(
        (res: any) => cb(res, null),
        (err: Error) =>
          err != null
            ? cb(null, err)
            : cb(null, new (GraphqlJitError as any)(""))
      )
      .catch(errorHandler);
    return;
  } else if (Array.isArray(value)) {
    return handleArrayValue(value, cb, errorHandler);
  }
  cb(value, null);
}

/**
 * Ensure that an array with possible local errors are handled cleanly.
 *
 * @param {any[]} value Array<Promise<any> | any> array of value
 * @param {Callback} cb
 * @param errorHandler handler for unexpected errors caused by bugs
 */
function handleArrayValue(
  value: any[],
  cb: Callback,
  errorHandler: (err: Error) => void
): void {
  // The array might have local errors which need to be handled locally in order for proper error messages
  let hasPromises = false;
  const values = value.map(item => {
    if (isPromise(item)) {
      // return the error
      // the following transformations will take care of the error
      hasPromises = true;
      return item.catch((err: Error) => {
        return err;
      });
    }
    return item;
  });
  if (hasPromises) {
    return unpromisify(
      // This promise should not reject but it is handled anyway
      () => Promise.all(values),
      (v: any, err: Error | null) => {
        if (err != null) {
          return cb(v, err);
        }
        return cb(v, null);
      },
      errorHandler
    );
  }
  cb(values, null);
}

/**
 * Implements a generic map operation for any iterable.
 *
 * If the iterable is not valid, null is returned.
 * @param {Iterable<any> | string} iterable possible iterable
 * @param {(a: any) => any} cb callback that receives the item being iterated
 * @returns {any[]} a new array with the result of the callback
 */
function safeMap(
  iterable: Iterable<any> | string,
  cb: (a: any, idx: number) => any
): any[] {
  let index = 0;
  const result = [];
  for (const a of iterable) {
    const item = cb(a, index);
    result.push(item);
    ++index;
  }
  return result;
}

/**
 * Extracts the names to be bounded on the compiled function
 * @param {CompilationContext} context that contains the function args
 * @returns {string} a comma separated string with variable names
 */
function getResolversVariablesName(context: CompilationContext): string {
  let decl = "";
  for (const name of context.dependencies.keys()) {
    decl += `${name},`;
  }
  return decl;
}

/**
 * Gets the variables that should be bounded to the compiled function
 * @param {CompilationContext} context that contains the function args
 * @returns {any[]} an array with references to the boundable variables
 */
function getFunctionResolvers(context: CompilationContext): any[] {
  const resolvers = [];
  for (const resolver of context.dependencies.values()) {
    resolvers.push(resolver);
  }
  return resolvers;
}

const MAGIC_MINUS_INFINITY =
  "__MAGIC_MINUS_INFINITY__71d4310a-d4a3-4a05-b1fe-e60779d24998";
const MAGIC_PLUS_INFINITY =
  "__MAGIC_PLUS_INFINITY__bb201c39-3333-4695-b4ad-7f1722e7aa7a";
const MAGIC_NAN = "__MAGIC_NAN__57f286b9-4c20-487f-b409-79804ddcb4f8";

function specialValueReplacer(_: any, value: any) {
  if (Number.isNaN(value)) {
    return MAGIC_NAN;
  }

  if (value === Infinity) {
    return MAGIC_PLUS_INFINITY;
  }

  if (value === -Infinity) {
    return MAGIC_MINUS_INFINITY;
  }

  return value;
}

function objectStringify(val: any): string {
  return JSON.stringify(val, specialValueReplacer)
    .replace(`"${MAGIC_NAN}"`, "NaN")
    .replace(`"${MAGIC_PLUS_INFINITY}"`, "Infinity")
    .replace(`"${MAGIC_MINUS_INFINITY}"`, "-Infinity");
}

/**
 * Calculates a GraphQLResolveInfo object for the resolver calls.
 *
 * if the resolver does not use, it returns null.
 * @param {CompilationContext} context compilation context to submit the resolveInfoResolver
 * @param parentType
 * @param fieldType
 * @param fieldName
 * @param fieldNodes
 * @param responsePath
 * @returns {string} a call to the resolve info creator or "{}" if unused
 */
function getExecutionInfo(
  context: CompilationContext,
  parentType: GraphQLObjectType,
  fieldType: GraphQLOutputType,
  fieldName: string,
  fieldNodes: FieldNode[],
  responsePath: ObjectPath
) {
  const resolveInfoName = createResolveInfoName(responsePath);
  const { schema, fragments, operation } = context;

  context.dependencies.set(
    resolveInfoName,
    createResolveInfoThunk(
      {
        schema,
        fragments,
        operation,
        parentType,
        fieldName,
        fieldType,
        fieldNodes
      },
      context.options.resolverInfoEnricher
    )
  );
  return `${resolveInfoName}(${GLOBAL_ROOT_NAME}, ${GLOBAL_VARIABLES_NAME}, ${serializeResponsePath(
    responsePath
  )})`;
}

function getArgumentsVarName(prefixName: string) {
  return `${prefixName}Args`;
}
function getValidArgumentsVarName(prefixName: string) {
  return `${prefixName}ValidArgs`;
}

function objectPath(topLevel: string, path: ObjectPath) {
  let objectPath = topLevel;
  const flattened = flattenPath(path);
  for (const section of flattened) {
    if (section.type === "literal") {
      objectPath += `["${section.key}"]`;
    } else {
      throw new Error("should only have received literal paths");
    }
  }
  return objectPath;
}

/**
 * Returns a static object with the all the arguments needed for the resolver
 * @param context
 * @param {Arguments} args
 * @param topLevelArg name of the toplevel
 * @param validArgs
 * @param returnType
 * @param path
 * @returns {string}
 */
function getArguments(
  context: CompilationContext,
  args: Arguments,
  topLevelArg: string,
  validArgs: string,
  returnType: GraphQLOutputType,
  path: ObjectPath
): string {
  // default to assuming arguments are valid
  let body = `
  let ${validArgs} = true;
  const ${topLevelArg} = ${objectStringify(args.values)};
  `;
  const errorDestination = isNonNullType(returnType)
    ? GLOBAL_NULL_ERRORS_NAME
    : GLOBAL_ERRORS_NAME;
  for (const variable of args.missing) {
    const varName = variable.valueNode.name.value;
    body += `if (Object.prototype.hasOwnProperty.call(${GLOBAL_VARIABLES_NAME}, "${varName}")) {`;
    if (variable.argument && isNonNullType(variable.argument.definition.type)) {
      const message = `'Argument "${
        variable.argument.definition.name
      }" of non-null type "${inspect(
        variable.argument.definition.type
      )}" must not be null.'`;
      body += `if (${GLOBAL_VARIABLES_NAME}['${
        variable.valueNode.name.value
      }'] == null) {
      ${errorDestination}.push(${createErrorObject(
        context,
        [variable.argument.node.value],
        path,
        message
      )});
      ${validArgs} = false;
      }`;
    }
    body += `
    ${objectPath(topLevelArg, variable.path)} = ${GLOBAL_VARIABLES_NAME}['${
      variable.valueNode.name.value
    }'];
    }`;
    // If there is no default value and no variable input
    // throw a field error
    if (
      variable.argument &&
      isNonNullType(variable.argument.definition.type) &&
      variable.argument.definition.defaultValue === undefined
    ) {
      const message = `'Argument "${
        variable.argument.definition.name
      }" of required type "${inspect(
        variable.argument.definition.type
      )}" was provided the variable "$${varName}" which was not provided a runtime value.'`;
      body += ` else {
      ${errorDestination}.push(${createErrorObject(
        context,
        [variable.argument.node.value],
        path,
        message
      )});
      ${validArgs} = false;
        }`;
    }
  }
  return body;
}

/**
 *  Safety checks for resolver execution is done via side effects every time a resolver function
 *  is encountered.
 *
 *  This function generates the declarations, so the side effect is valid code.
 *
 * @param {CompilationContext} context compilation context
 * @param {boolean} defaultValue usually false, meant to be true at the top level
 * @returns {string} a list of declarations eg: var __validNode0 = false;\nvar __validNode1 = false;
 */
function generateUniqueDeclarations(
  context: CompilationContext,
  defaultValue: boolean = false
) {
  return context.deferred
    .map((_, idx) => `var ${SAFETY_CHECK_PREFIX}${idx} = ${defaultValue};`)
    .join("\n");
}

function createSubCompilationContext(
  context: CompilationContext
): CompilationContext {
  return { ...context, deferred: [] };
}

export function isPromise(value: any): value is Promise<any> {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value.then === "function"
  );
}

/**
 * Serializes the response path for an error response.
 *
 * @param {ObjectPath | undefined} path response path of a field
 * @returns {string} filtered serialization of the response path
 */
function serializeResponsePathAsArray(path: ObjectPath) {
  const flattened = flattenPath(path);
  let src = "[";
  for (let i = flattened.length - 1; i >= 0; i--) {
    // meta is only used for the function name
    if (flattened[i].type === "meta") {
      continue;
    }
    src +=
      flattened[i].type === "literal"
        ? `"${flattened[i].key}",`
        : `${flattened[i].key},`;
  }
  return src + "]";
}

function createResolveInfoName(path: ObjectPath) {
  return (
    flattenPath(path)
      .map(p => p.key)
      .join("_") + "Info"
  );
}

/**
 * Serializes the response path for the resolve info function
 * @param {ObjectPath | undefined} path response path of a field
 * @returns {string} filtered serialization of the response path
 */
function serializeResponsePath(path: ObjectPath | undefined): string {
  if (!path) {
    return "undefined";
  }
  if (path.type === "meta") {
    // meta is ignored while serializing for the resolve info functions
    return serializeResponsePath(path.prev);
  }
  const literalValue = `"${path.key}"`;
  return `{
    key:  ${path.type === "literal" ? literalValue : path.key},
    prev: ${serializeResponsePath(path.prev)}
  }`;
}

/**
 * Returned a bound serialization function of a scalar or enum
 * @param {GraphQLScalarType | GraphQLEnumType} scalar
 * @param customSerializer custom serializer
 * @returns {(v: any) => any} bound serializationFunction
 */
function getSerializer(
  scalar: GraphQLScalarType | GraphQLEnumType,
  customSerializer?: GraphQLScalarSerializer<any>
): (v: any, onError: (msg: string) => void) => any {
  const { name } = scalar;
  const serialize = customSerializer
    ? customSerializer
    : (val: any) => scalar.serialize(val);
  return (v: any, onError: (msg: string) => void) => {
    try {
      const value = serialize(v);
      if (isInvalid(value)) {
        onError(`Expected a value of type "${name}" but received: ${v}`);
        return null;
      }
      return value;
    } catch (e) {
      onError(
        (e && e.message) ||
          `Expected a value of type "${name}" but received an Error`
      );
      return null;
    }
  };
}

/**
 * Default abstract type resolver.
 *
 * It only handle sync type resolving.
 * @param value
 * @param contextValue
 * @param {GraphQLResolveInfo} info
 * @param {GraphQLAbstractType} abstractType
 * @returns {string | GraphQLObjectType}
 */
function defaultResolveTypeFn(
  value: any,
  contextValue: any,
  info: GraphQLResolveInfo,
  abstractType: GraphQLAbstractType
): string | GraphQLObjectType {
  // First, look for `__typename`.
  if (
    value != null &&
    typeof value === "object" &&
    typeof value.__typename === "string"
  ) {
    return value.__typename;
  }

  // Otherwise, test each possible type.
  const possibleTypes = info.schema.getPossibleTypes(abstractType);
  for (const type of possibleTypes) {
    if (type.isTypeOf) {
      const isTypeOfResult = type.isTypeOf(value, contextValue, info);

      if (isPromise(isTypeOfResult)) {
        throw new Error(
          `Promises are not supported for resolving type of ${value}`
        );
      } else if (isTypeOfResult) {
        return type;
      }
    }
  }

  throw new Error(`Could not resolve type of ${value}`);
}

/**
 * Constructs a ExecutionContext object from the arguments passed to
 * execute, which we will pass throughout the other execution methods.
 *
 * Throws a GraphQLError if a valid execution context cannot be created.
 */
function buildCompilationContext(
  schema: GraphQLSchema,
  document: DocumentNode,
  options: CompilerOptions,
  operationName?: string
): CompilationContext {
  const errors: GraphQLError[] = [];
  let operation: OperationDefinitionNode | void;
  let hasMultipleAssumedOperations = false;
  const fragments: { [key: string]: FragmentDefinitionNode } = Object.create(
    null
  );
  for (const definition of document.definitions) {
    switch (definition.kind) {
      case Kind.OPERATION_DEFINITION:
        if (!operationName && operation) {
          hasMultipleAssumedOperations = true;
        } else if (
          !operationName ||
          (definition.name && definition.name.value === operationName)
        ) {
          operation = definition;
        }
        break;
      case Kind.FRAGMENT_DEFINITION:
        fragments[definition.name.value] = definition;
        break;
    }
  }

  if (!operation) {
    if (operationName) {
      throw new GraphQLError(`Unknown operation named "${operationName}".`);
    } else {
      throw new GraphQLError("Must provide an operation.");
    }
  } else if (hasMultipleAssumedOperations) {
    throw new GraphQLError(
      "Must provide operation name if query contains multiple operations."
    );
  }

  return {
    schema,
    fragments,
    rootValue: null,
    contextValue: null,
    operation,
    options,
    dependencies: new Map(),
    deferred: [],
    depth: 0,
    variableValues: {},
    fieldResolver: undefined as any,
    errors: errors as any
  };
}

function getFieldNodesName(nodes: FieldNode[]) {
  return nodes.length > 1
    ? "(" + nodes.map(({ name }) => name.value).join(",") + ")"
    : nodes[0].name.value;
}

function createErrorObject(
  context: CompilationContext,
  nodes: ASTNode[],
  path: ObjectPath,
  message: string,
  originalError?: string
): string {
  return `new GraphQLError(${message},
    ${JSON.stringify(computeLocations(nodes))},
      ${serializeResponsePathAsArray(path)},
      ${originalError ? originalError : "undefined"},
      ${context.options.disablingCapturingStackErrors ? "true" : "false"})`;
}

function getResolverName(parentName: string, name: string) {
  return parentName + name + "Resolver";
}

function getTypeResolverName(name: string) {
  return name + "TypeResolver";
}

function getSerializerName(name: string) {
  return name + "Serializer";
}

/**
 * Create the function signature
 * @param {CompilationContext} context compilation context
 * @returns {string} compiled function signature
 */
function getFunctionSignature(context: CompilationContext) {
  return `return function query (
  ${GLOBAL_ROOT_NAME}, ${GLOBAL_CONTEXT_NAME}, ${GLOBAL_VARIABLES_NAME}, ${GLOBAL_EXECUTOR_NAME},
   __resolveIfDone, __safeMap, GraphQLError,
    ${getResolversVariablesName(context)})`;
}

// static function footer that contain bookkeeping for sync resolutions
const functionFooter = `
  __resolveIfDone(${GLOBAL_DATA_NAME}, ${GLOBAL_ERRORS_NAME}, ${GLOBAL_NULL_ERRORS_NAME})
`;
// static function header that contain bookkeeping
// for the callbacks being used throughout the tree
const functionHeader = `
  "use strict";
  const ${GLOBAL_NULL_ERRORS_NAME} = [];
  const ${GLOBAL_ERRORS_NAME} = [];
`;

/**
 * Handles the book keeping of running promises
 * loosely and returning a final callback.
 *
 * The final callback is called after every possible promise has returned.
 *
 * Exported only for tests.
 *
 * @param finalCb callback to be called once the all promises have been resolved
 * @param {(err: Error) => void} errorHandler global error handler in case of bugs in the runtime
 * @returns an object with two function, a execute function and checker when everything is resolved
 */
export function loosePromiseExecutor(
  finalCb: (
    data: object,
    errors: GraphQLError[],
    nullErrors: GraphQLError[]
  ) => void,
  errorHandler: (err: Error) => void
) {
  let counter = 1; // start with one to handle sync operations

  // this will be called in the function footer for sync
  function resolveIfDone(
    data: object,
    errors: GraphQLError[],
    nullErrors: GraphQLError[]
  ) {
    --counter;
    if (counter === 0) {
      finalCb(data, errors, nullErrors);
    }
  }

  function executor(
    resolver: () => Promise<any>,
    cb: JITCallback,
    parent: object,
    data: object,
    errors: GraphQLError[],
    nullErrors: GraphQLError[]
  ) {
    counter++;
    unpromisify(
      resolver,
      (res, err) => {
        cb(parent, res, err);
        resolveIfDone(data, errors, nullErrors);
      },
      errorHandler
    );
  }

  return {
    executor,
    resolveIfDone
  };
}

/**
 * Handles the book keeping of running the top level promises serially.
 * The serial phase places all units of work in a queue which
 * is only started once startExecution is triggered.
 *
 * From then on, any new work is executed with the parallel executor.
 * New work is executed within the lifespan of the top level promise.
 * Once all promises are over, the executor will move on to the next serial
 * piece of work.
 *
 * The final callback is called after every possible promise has returned.
 *
 * Exported only for tests.
 *
 * @param finalCb callback to be called once the all promises have been resolved
 * @param {(err: Error) => void} errorHandler global error handler in case of bugs in the runtime
 * @returns an object with two function, a execute function to submit work and
 * startExecution to trigger the execution of everything submitted so far.
 */
export function serialPromiseExecutor(
  finalCb: (
    data: object,
    errors: GraphQLError[],
    nullErrors: GraphQLError[]
  ) => void,
  errorHandler: (err: Error) => void
) {
  const queue: Array<{
    executor: (
      resolver: () => Promise<any>,
      cb: JITCallback,
      parent: object,
      data: object,
      errors: GraphQLError[],
      nullErrors: GraphQLError[]
    ) => void;
    resolveIfDone: (
      data: object,
      errors: GraphQLError[],
      nullErrors: GraphQLError[]
    ) => void;
    resolver: () => Promise<any>;
    cb: JITCallback;
    parent: object;
  }> = [];
  // Serial phase is running until execution starts
  let serialPhase = true;
  let currentExecutor: any;

  // this will be called in the function footer for starting the execution
  function continueExecution(
    data: object,
    errors: GraphQLError[],
    nullErrors: GraphQLError[]
  ) {
    serialPhase = false;
    const postponedWork = queue.shift();
    if (postponedWork) {
      const { resolver, cb, parent, executor, resolveIfDone } = postponedWork;
      currentExecutor = executor;
      currentExecutor(resolver, cb, parent, data, errors, nullErrors);
      resolveIfDone(data, errors, nullErrors);
      return;
    }
    finalCb(data, errors, nullErrors);
  }

  function addToQueue(
    resolver: () => Promise<any>,
    cb: JITCallback,
    parent: object,
    data: object,
    errors: GraphQLError[],
    nullErrors: GraphQLError[]
  ) {
    if (serialPhase) {
      const { executor, resolveIfDone } = loosePromiseExecutor(
        (data: object, errors: GraphQLError[], nullErrors: GraphQLError[]) =>
          continueExecution(data, errors, nullErrors),
        errorHandler
      );
      queue.push({
        executor,
        resolveIfDone,
        resolver,
        cb,
        parent
      });
    } else {
      // We are using the parallel executor once the serial phase is over
      currentExecutor(resolver, cb, parent, data, errors, nullErrors);
    }
  }

  return {
    addToQueue,
    startExecution: continueExecution
  };
}

function normalizeErrors(err: Error[] | Error): GraphQLError[] {
  if (Array.isArray(err)) {
    return err.map(e => normalizeError(e));
  }
  return [normalizeError(err)];
}

function normalizeError(err: Error): GraphQLError {
  return err instanceof GraphQLError
    ? err
    : new (GraphqlJitError as any)(
        err.message,
        (err as any).locations,
        (err as any).path,
        err
      );
}

/**
 * Returns true if a value is undefined, or NaN.
 */
function isInvalid(value: any): boolean {
  return value === undefined || value !== value;
}
