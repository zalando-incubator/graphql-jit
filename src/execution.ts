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
  GraphQLFieldResolver,
  GraphQLIsTypeOfFn,
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
  print,
  TypeNameMetaFieldDef
} from "graphql";
import {
  collectFields,
  ExecutionContext as GraphQLContext
} from "graphql/execution/execute";
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
import {
  CoercedVariableValues,
  compileVariableParsing,
  failToParseVariables
} from "./variables";

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
interface CompilationContext extends GraphQLContext {
  resolvers: { [key: string]: GraphQLFieldResolver<any, any, any> };
  serializers: {
    [key: string]: (
      c: ExecutionContext,
      v: any,
      onError: (c: ExecutionContext, msg: string) => void
    ) => any;
  };
  hoistedFunctions: string[];
  hoistedFunctionNames: Map<string, number>;
  typeResolvers: { [key: string]: GraphQLTypeResolver<any, any> };
  isTypeOfs: { [key: string]: GraphQLIsTypeOfFn<any, any> };
  resolveInfos: { [key: string]: any };
  deferred: DeferredField[];
  options: CompilerOptions;
  depth: number;
}

// prefix for the variable used ot cache validation results
const SAFETY_CHECK_PREFIX = "__validNode";
const GLOBAL_DATA_NAME = "__context.data";
const GLOBAL_ERRORS_NAME = "__context.errors";
const GLOBAL_NULL_ERRORS_NAME = "__context.nullErrors";
const GLOBAL_EXECUTOR_NAME = "__context.executor";
const GLOBAL_ROOT_NAME = "__context.rootValue";
const GLOBAL_VARIABLES_NAME = "__context.variables";
const GLOBAL_CONTEXT_NAME = "__context.context";
const GLOBAL_EXECUTION_CONTEXT = "__context";
const GLOBAL_INSPECT_NAME = "__context.inspect";
const GLOBAL_SAFE_MAP_NAME = "__context.safeMap";
const GRAPHQL_ERROR = "__context.GraphQLError";
const GLOBAL_PARENT_NAME = "__parent";

interface ExecutionContext {
  data: any;
  errors: GraphQLError[];
  nullErrors: GraphQLError[];
  executor: PromiseExecutor;
  resolveIfDone: any;
  inspect: typeof inspect;
  variables: { [key: string]: any };
  context: any;
  rootValue: any;
  safeMap: typeof safeMap;
  GraphQLError: typeof GraphqlJitError;
  resolvers: { [key: string]: GraphQLFieldResolver<any, any, any> };
  serializers: {
    [key: string]: (
      c: ExecutionContext,
      v: any,
      onError: (c: ExecutionContext, msg: string) => void
    ) => any;
  };
  typeResolvers: { [key: string]: GraphQLTypeResolver<any, any> };
  isTypeOfs: { [key: string]: GraphQLIsTypeOfFn<any, any> };
  resolveInfos: { [key: string]: any };
}

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

export type SuccessCallback = (
  c: ExecutionContext,
  parent: any,
  d: object,
  ...idx: number[]
) => void;
export type ErrorCallback = (
  c: ExecutionContext,
  e: Error,
  ...idx: number[]
) => void;

export interface CompiledQuery {
  operationName?: string;
  query: (
    root: any,
    context: any,
    variables: Maybe<{ [key: string]: any }>
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

    const functionBody = compileOperation(context);
    return {
      query: createBoundQuery(
        context,
        document,
        new Function("return " + functionBody)(),
        getVariables,
        context.operation.name != null
          ? context.operation.name.value
          : undefined
      ),
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
  func: (context: ExecutionContext) => void,
  getVariableValues: (inputs: { [key: string]: any }) => CoercedVariableValues,
  operationName?: string
) {
  const {
    operation: { operation },
    resolvers,
    typeResolvers,
    isTypeOfs,
    serializers,
    resolveInfos
  } = compilationContext;
  const trimmer = createNullTrimmer(compilationContext);
  const fnName = operationName ? operationName : "query";

  /* tslint:disable */
  /**
   * In-order to assign a debuggable name to the bound query function,
   * we create an intermediate object with a method named as the
   * intended function name. This is because Function.prototype.name
   * is not writeable.
   *
   * http://www.ecma-international.org/ecma-262/6.0/#sec-method-definitions-runtime-semantics-propertydefinitionevaluation
   *
   * section: 14.3.9.3 - calls SetFunctionName
   */
  /* tslint:enable */
  const ret = {
    [fnName](
      rootValue: any,
      context: any,
      variables: Maybe<{ [key: string]: any }>
    ): Promise<ExecutionResult> | ExecutionResult {
      // this can be shared across in a batch request
      const parsedVariables = getVariableValues(variables || {});

      // Return early errors if variable coercing failed.
      if (failToParseVariables(parsedVariables)) {
        return { errors: parsedVariables.errors };
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
      const callback = (context: ExecutionContext) => {
        if (result) {
          throw new Error("called the final cb more than once");
        }
        maybePromise.resolve(postProcessResult(trimmer, context));
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
        resolveIfDone = serial.startOrContinueExecution;
      } else {
        const loose = loosePromiseExecutor(callback, globalErrorHandler);
        executor = loose.executor;
        resolveIfDone = loose.resolveIfDone;
      }
      const executionContext: ExecutionContext = {
        rootValue,
        context,
        variables: parsedVariables.coerced,
        executor,
        resolveIfDone,
        safeMap,
        inspect,
        GraphQLError: GraphqlJitError,
        resolvers,
        typeResolvers,
        isTypeOfs,
        serializers,
        resolveInfos,
        data: {},
        nullErrors: [],
        errors: []
      };
      func.call(null, executionContext);
      if (result) {
        return result;
      }
      return new Promise((resolve, reject) => {
        maybePromise.resolve = resolve;
        maybePromise.reject = reject;
      });
    }
  };

  return ret[fnName];
}

function postProcessResult(
  trimmer: NullTrimmer,
  { data, nullErrors, errors }: ExecutionContext
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
    [],
    [GLOBAL_ROOT_NAME],
    [GLOBAL_DATA_NAME],
    undefined,
    GLOBAL_ERRORS_NAME,
    fieldMap,
    true
  );
  let body = `function query (${GLOBAL_EXECUTION_CONTEXT}) {
  "use strict";
`;
  body += generateUniqueDeclarations(context, true);
  body += `${GLOBAL_DATA_NAME} = ${topLevel}\n`;
  body += compileDeferredFields(
    context,
    context.operation.operation === "mutation"
  );
  body += `
  ${GLOBAL_EXECUTION_CONTEXT}.resolveIfDone(${GLOBAL_EXECUTION_CONTEXT});
  }`;
  body += context.hoistedFunctions.join("\n");
  return body;
}

/**
 * Processes the deferred node list in the compilation context.
 *
 * Each deferred node get a copy of the compilation context with
 * a new empty list for deferred nodes to properly scope the nodes.
 * @param {CompilationContext} context compilation context
 * @param isMutation {boolean} set on the top level if the operation is a mutation
 * @returns {string} compiled transformations all of deferred nodes
 */
function compileDeferredFields(
  context: CompilationContext,
  isMutation: boolean = false
): string {
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
        [`${GLOBAL_PARENT_NAME}.${name}`],
        responsePath
      );
      const parentIndexes = getParentIndexes(context);
      const resolverName = getResolverName(parentType.name, fieldName);
      const resolverHandler = getHoistedFunctionName(
        context,
        `${name}${resolverName}Handler`
      );
      const resolverErrorHandler = getHoistedFunctionName(
        context,
        `${name}${resolverName}ErrorHandler`
      );
      const topLevelArgs = getArgumentsVarName(resolverName);
      const validArgs = getValidArgumentsVarName(resolverName);
      const executionError = createErrorObject(
        context,
        fieldNodes,
        responsePath,
        "err.message != null ? err.message : err",
        "err"
      );
      const resolverCall = `${GLOBAL_EXECUTION_CONTEXT}.resolvers.${resolverName}(${originPaths.join(
        "."
      )},${topLevelArgs},${GLOBAL_CONTEXT_NAME},
            ${getExecutionInfo(
              subContext,
              parentType,
              fieldType,
              fieldName,
              fieldNodes,
              responsePath
            )})`;
      let mainBody;
      if (isMutation) {
        mainBody = `
           ${GLOBAL_EXECUTOR_NAME}(${GLOBAL_EXECUTION_CONTEXT}, () => ${resolverCall}, ${resolverHandler},
           ${resolverErrorHandler}, ${destinationPaths.join(
          "."
        )}, ${parentIndexes});
        `;
      } else {
        mainBody = `
          let __value = null;
          try {
            __value = ${resolverCall};
          } catch (err) {
          ${getErrorDestination(fieldType)}.push(${executionError});
          }
          if (${isPromiseInliner("__value")}) {
           ${GLOBAL_EXECUTOR_NAME}(${GLOBAL_EXECUTION_CONTEXT}, __value, ${resolverHandler}, ${resolverErrorHandler},
            ${destinationPaths.join(".")}, ${parentIndexes});
          } else {
            ${resolverHandler}(${GLOBAL_EXECUTION_CONTEXT}, ${destinationPaths.join(
          "."
        )}, __value, ${parentIndexes});
          }`;
      }
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
          ${mainBody}
        }
      }`;
      context.hoistedFunctions.push(`
      function ${resolverErrorHandler}(${GLOBAL_EXECUTION_CONTEXT}, err, ${parentIndexes}) {
      ${getErrorDestination(fieldType)}.push(${executionError});}
      `);
      context.hoistedFunctions.push(`
       function ${resolverHandler}(${GLOBAL_EXECUTION_CONTEXT}, ${GLOBAL_PARENT_NAME}, ${fieldName}, ${parentIndexes}) {
          ${generateUniqueDeclarations(subContext)}
          ${GLOBAL_PARENT_NAME}.${name} = ${nodeBody};\n
          ${compileDeferredFields(subContext)}
        }
      `);
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
      fieldNodes,
      originPaths,
      destinationPaths,
      previousPath,
      errorDestination,
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
    const serializerName = getSerializerName(type.name);
    context.serializers[serializerName] = getSerializer(
      type,
      context.options.customSerializers[type.name]
    );
    const parentIndexes = getParentIndexes(context);
    const serializerErrorHandler = getHoistedFunctionName(
      context,
      `${type.name}${originPaths.join("")}SerializerErrorHandler`
    );
    context.hoistedFunctions.push(`
    function ${serializerErrorHandler}(${GLOBAL_EXECUTION_CONTEXT}, message, ${parentIndexes}) {
    ${errorDestination}.push(${createErrorObject(
      context,
      fieldNodes,
      previousPath,
      "message"
    )});}
    `);
    body += `${GLOBAL_EXECUTION_CONTEXT}.serializers.${serializerName}(${GLOBAL_EXECUTION_CONTEXT}, ${originPaths.join(
      "."
    )}, ${serializerErrorHandler}, ${parentIndexes})`;
  }
  return body;
}

/**
 * Compile a node of object type.
 * @param {CompilationContext} context
 * @param {GraphQLObjectType} type type of the node
 * @param fieldNodes fieldNodes array with the nodes references
 * @param originPaths originPaths path in the parent object from where to fetch results
 * @param destinationPaths path in the where to write the result
 * @param responsePath response path until this node
 * @param errorDestination Path for error array
 * @param fieldMap map of fields to fieldNodes array with the nodes references
 * @param alwaysDefer used to force the field to be resolved with a resolver ala graphql-js
 * @returns {string}
 */
function compileObjectType(
  context: CompilationContext,
  type: GraphQLObjectType,
  fieldNodes: FieldNode[],
  originPaths: string[],
  destinationPaths: string[],
  responsePath: ObjectPath | undefined,
  errorDestination: string,
  fieldMap: { [key: string]: FieldNode[] },
  alwaysDefer: boolean
): string {
  let body = "(";
  if (typeof type.isTypeOf === "function" && !alwaysDefer) {
    context.isTypeOfs[type.name + "IsTypeOf"] = type.isTypeOf;
    body += `!${GLOBAL_EXECUTION_CONTEXT}.isTypeOfs["${
      type.name
    }IsTypeOf"](${originPaths.join(
      "."
    )}) ? (${errorDestination}.push(${createErrorObject(
      context,
      fieldNodes,
      responsePath as any,
      `\`Expected value of type "${
        type.name
      }" but got: $\{${GLOBAL_INSPECT_NAME}(${originPaths.join(".")})}.\``
    )}), null) :`;
  }
  body += "{";
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

    // Inline __typename
    // No need to call a resolver for typename
    if (field === TypeNameMetaFieldDef) {
      body += `"${type.name}",`;
      continue;
    }

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
      context.resolvers[getResolverName(type.name, field.name)] = resolver;
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
  body += "})";
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
  const typeResolverName = getTypeResolverName(type.name);
  context.typeResolvers[typeResolverName] = resolveType;
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
    ${GLOBAL_EXECUTION_CONTEXT}.typeResolvers.${typeResolverName}(${originPaths.join(
    "."
  )},
    ${GLOBAL_CONTEXT_NAME},
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
  const fieldType = type.ofType;
  const dataBody = compileType(
    listContext,
    parentType,
    fieldType,
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
  const executionError = createErrorObject(
    context,
    fieldNodes,
    addPath(responsePath, "idx" + newDepth, "variable"),
    "err.message != null ? err.message : err",
    "err"
  );
  const uniqueDeclarations = generateUniqueDeclarations(listContext);
  const deferredFields = compileDeferredFields(listContext);
  const safeMapPromiseHandler = getHoistedFunctionName(
    context,
    `${parentType.name}${originalObjectPaths.join("")}MapPromiseHandler`
  );
  listContext.hoistedFunctions.push(`
  function ${safeMapPromiseHandler}(${GLOBAL_EXECUTION_CONTEXT}, ${GLOBAL_PARENT_NAME}, __safeMapNode, ${getParentIndexes(
    listContext
  )}) {
    ${uniqueDeclarations}
    ${GLOBAL_PARENT_NAME}[idx${newDepth}] = ${dataBody};
    ${deferredFields}
  }
  `);
  const safeMapPromiseErrorHandler = getHoistedFunctionName(
    context,
    `${parentType.name}${originalObjectPaths.join("")}MapPromiseErrorHandler`
  );
  listContext.hoistedFunctions.push(`
  function ${safeMapPromiseErrorHandler}(${GLOBAL_EXECUTION_CONTEXT}, err, ${getParentIndexes(
    listContext
  )}) {
    ${getErrorDestination(fieldType)}.push(${executionError});
  }
  `);
  const safeMapHandler = getHoistedFunctionName(
    context,
    `${parentType.name}${originalObjectPaths.join("")}MapHandler`
  );
  listContext.hoistedFunctions.push(`
  function ${safeMapHandler}(${GLOBAL_EXECUTION_CONTEXT}, __safeMapNode, idx${newDepth}, newArray, ${getParentIndexes(
    context
  )}) {
    if (${isPromiseInliner("__safeMapNode")}) {
      ${GLOBAL_EXECUTOR_NAME}(${GLOBAL_EXECUTION_CONTEXT}, __safeMapNode, ${safeMapPromiseHandler},
      ${safeMapPromiseErrorHandler}, newArray, ${getParentIndexes(
    listContext
  )});
      return null;
    }
    ${uniqueDeclarations}
    const __child = ${dataBody};
    ${deferredFields}
    return __child;
  }
  `);
  return `(typeof ${name} === "string" || typeof ${name}[Symbol.iterator] !== "function") ?  ${errorCase} :
  ${GLOBAL_SAFE_MAP_NAME}(${GLOBAL_EXECUTION_CONTEXT}, ${name}, ${safeMapHandler}, ${getParentIndexes(
    context
  )})`;
}

/**
 * Implements a generic map operation for any iterable.
 *
 * If the iterable is not valid, null is returned.
 * @param context
 * @param {Iterable<any> | string} iterable possible iterable
 * @param {(a: any) => any} cb callback that receives the item being iterated
 * @param idx
 * @returns {any[]} a new array with the result of the callback
 */
function safeMap(
  context: ExecutionContext,
  iterable: Iterable<any> | string,
  cb: (
    context: ExecutionContext,
    a: any,
    index: number,
    newArray: any[],
    ...idx: number[]
  ) => any,
  ...idx: number[]
): any[] {
  let index = 0;
  const result = [];
  for (const a of iterable) {
    const item = cb(context, a, index, result, ...idx);
    result.push(item);
    ++index;
  }
  return result;
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

  context.resolveInfos[resolveInfoName] = createResolveInfoThunk(
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
  );
  return `${GLOBAL_EXECUTION_CONTEXT}.resolveInfos.${resolveInfoName}(${GLOBAL_ROOT_NAME}, ${GLOBAL_VARIABLES_NAME}, ${serializeResponsePath(
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
  const errorDestination = getErrorDestination(returnType);
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

export function isPromiseInliner(value: string): string {
  return `${value} != null && typeof ${value} === "object" && typeof ${value}.then === "function"`;
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

function getErrorDestination(type: GraphQLType): string {
  return isNonNullType(type) ? GLOBAL_NULL_ERRORS_NAME : GLOBAL_ERRORS_NAME;
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
) {
  const { name } = scalar;
  const serialize = customSerializer
    ? customSerializer
    : (val: any) => scalar.serialize(val);
  return function leafSerializer(
    context: ExecutionContext,
    v: any,
    onError: (c: ExecutionContext, msg: string, ...idx: number[]) => void,
    ...idx: number[]
  ) {
    try {
      const value = serialize(v);
      if (isInvalid(value)) {
        onError(
          context,
          `Expected a value of type "${name}" but received: ${v}`,
          ...idx
        );
        return null;
      }
      return value;
    } catch (e) {
      onError(
        context,
        (e && e.message) ||
          `Expected a value of type "${name}" but received an Error`,
        ...idx
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
    resolvers: {},
    serializers: {},
    typeResolvers: {},
    isTypeOfs: {},
    resolveInfos: {},
    hoistedFunctions: [],
    hoistedFunctionNames: new Map(),
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

function getHoistedFunctionName(context: CompilationContext, name: string) {
  const count = context.hoistedFunctionNames.get(name);
  if (count === undefined) {
    context.hoistedFunctionNames.set(name, 0);
    return name;
  }
  context.hoistedFunctionNames.set(name, count + 1);
  return `${name}${count + 1}`;
}

function createErrorObject(
  context: CompilationContext,
  nodes: ASTNode[],
  path: ObjectPath,
  message: string,
  originalError?: string
): string {
  return `new ${GRAPHQL_ERROR}(${message},
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

type PromiseExecutor = (
  context: ExecutionContext,
  resolver: Promise<any>,
  success: SuccessCallback,
  error: ErrorCallback,
  parent: object,
  ...idxs: number[]
) => void;

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
  finalCb: (context: ExecutionContext) => void,
  errorHandler: (err: Error) => void
) {
  let counter = 1; // start with one to handle sync operations

  // this will be called in the function footer for sync
  function resolveIfDone(context: ExecutionContext) {
    --counter;
    if (counter === 0) {
      finalCb(context);
    }
  }

  function executor(
    context: ExecutionContext,
    value: Promise<any>,
    success: SuccessCallback,
    error: ErrorCallback,
    parent: object,
    ...idx: number[]
  ) {
    counter++;
    value
      .then(
        res => {
          success(context, parent, res, ...idx);
          resolveIfDone(context);
        },
        err => {
          error(context, err || new (GraphqlJitError as any)(""), ...idx);
          resolveIfDone(context);
        }
      )
      .catch(errorHandler);
  }

  function delayedExecutor(
    context: ExecutionContext,
    valueGen: () => Promise<any> | any,
    success: SuccessCallback,
    error: ErrorCallback,
    parent: object
  ) {
    counter++;
    let value;
    try {
      value = valueGen();
    } catch (e) {
      error(context, e);
      resolveIfDone(context);
      return;
    }
    if (isPromise(value)) {
      value
        .then(
          res => {
            success(context, parent, res);
            resolveIfDone(context);
          },
          err => {
            error(context, err || new (GraphqlJitError as any)(""));
            resolveIfDone(context);
          }
        )
        .catch(errorHandler);
      return;
    }
    success(context, parent, value);
    resolveIfDone(context);
  }

  return {
    delayedExecutor,
    executor,
    resolveIfDone
  };
}

/**
 * Handles the book keeping of running the top level promises serially.
 * The serial phase places all units of work in a queue which
 * is only started once startOrContinueExecution is triggered.
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
  finalCb: (context: ExecutionContext) => void,
  errorHandler: (err: Error) => void
) {
  const queue: Array<{
    looseExecutor: {
      executor: PromiseExecutor;
      delayedExecutor: (
        context: ExecutionContext,
        resolver: () => Promise<any>,
        success: SuccessCallback,
        error: ErrorCallback,
        parent: object
      ) => void;
      resolveIfDone: (context: ExecutionContext) => void;
    };
    value: () => Promise<any>;
    success: SuccessCallback;
    error: ErrorCallback;
    parent: object;
  }> = [];
  // Serial phase is running until execution starts
  let serialPhase = true;
  let currentPostponedJob = 0;
  let currentParallelExecutor: PromiseExecutor;

  // this will be called in the function footer for starting the execution
  function startOrContinueExecution(context: ExecutionContext) {
    serialPhase = false;
    if (currentPostponedJob < queue.length) {
      const { value, success, error, parent, looseExecutor } = queue[
        currentPostponedJob
      ];
      queue[currentPostponedJob] = null as any; // allow GC to clean up sooner
      currentPostponedJob++;
      currentParallelExecutor = looseExecutor.executor;
      looseExecutor.delayedExecutor(context, value, success, error, parent);
      looseExecutor.resolveIfDone(context);
      return;
    }
    finalCb(context);
  }

  function addToQueue(
    context: ExecutionContext,
    value: any,
    success: SuccessCallback,
    error: ErrorCallback,
    parent: object,
    ...idx: number[]
  ) {
    if (serialPhase) {
      const looseExecutor = loosePromiseExecutor(
        startOrContinueExecution,
        errorHandler
      );
      queue.push({
        looseExecutor,
        value,
        success,
        error,
        parent
      });
    } else {
      // We are using the parallel executor once the serial phase is over
      currentParallelExecutor(context, value, success, error, parent, ...idx);
    }
  }

  return {
    addToQueue,
    startOrContinueExecution
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

function getParentIndexes(context: CompilationContext) {
  let args = "";
  for (let i = 1; i <= context.depth; ++i) {
    if (i > 1) {
      args += ", ";
    }
    args += `idx${i}`;
  }
  return args;
}
