import { TypedDocumentNode } from "@graphql-typed-document-node/core";
import fastJson from "fast-json-stringify";
import genFn from "generate-function";
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
  locatedError,
  TypeNameMetaFieldDef
} from "graphql";
import { ExecutionContext as GraphQLContext } from "graphql/execution/execute";
import { pathToArray } from "graphql/jsutils/Path";
import { FieldNode, OperationDefinitionNode } from "graphql/language/ast";
import { GraphQLTypeResolver } from "graphql/type/definition";
import {
  addPath,
  Arguments,
  collectFields,
  collectSubfields,
  computeLocations,
  FieldsAndNodes,
  flattenPath,
  getArgumentDefs,
  JitFieldNode,
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
import { Maybe } from "./types";
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

interface ExecutionContext {
  promiseCounter: number;
  data: any;
  errors: GraphQLError[];
  nullErrors: GraphQLError[];
  resolve?: () => void;
  inspect: typeof inspect;
  variables: { [key: string]: any };
  context: any;
  rootValue: any;
  safeMap: typeof safeMap;
  GraphQLError: typeof GraphqlJitError;
  resolvers: { [key: string]: GraphQLFieldResolver<any, any, any> };
  trimmer: NullTrimmer;
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
  jsFieldName: string;
  fieldType: GraphQLOutputType;
  fieldNodes: FieldNode[];
  args: Arguments;
}

/**
 * The context used during compilation.
 *
 * It stores deferred nodes to be processed later as well as the function arguments to be bounded at top level
 */
export interface CompilationContext extends GraphQLContext {
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
const GLOBAL_ROOT_NAME = "__context.rootValue";
export const GLOBAL_VARIABLES_NAME = "__context.variables";
const GLOBAL_CONTEXT_NAME = "__context.context";
const GLOBAL_EXECUTION_CONTEXT = "__context";
const GLOBAL_PROMISE_COUNTER = "__context.promiseCounter";
const GLOBAL_INSPECT_NAME = "__context.inspect";
const GLOBAL_SAFE_MAP_NAME = "__context.safeMap";
const GRAPHQL_ERROR = "__context.GraphQLError";
const GLOBAL_RESOLVE = "__context.resolve";
const GLOBAL_PARENT_NAME = "__parent";
const LOCAL_JS_FIELD_NAME_PREFIX = "__field";

export interface CompiledQuery<
  TResult = { [key: string]: any },
  TVariables = { [key: string]: any }
> {
  operationName?: string;
  query: (
    root: any,
    context: any,
    variables: Maybe<TVariables>
  ) => Promise<ExecutionResult<TResult>> | ExecutionResult<TResult>;
  subscribe?: (
    root: any,
    context: any,
    variables: Maybe<TVariables>
  ) => Promise<
    AsyncIterableIterator<ExecutionResult<TResult>> | ExecutionResult<TResult>
  >;
  stringify: (v: any) => string;
}

interface InternalCompiledQuery extends CompiledQuery {
  __DO_NOT_USE_THIS_OR_YOU_WILL_BE_FIRED_compilation?: string;
}

/**
 * It compiles a GraphQL query to an executable function
 * @param {GraphQLSchema} schema GraphQL schema
 * @param {DocumentNode} document Query being submitted
 * @param {string} operationName name of the operation
 * @param partialOptions compilation options to tune the compiler features
 * @returns {CompiledQuery} the cacheable result
 */
export function compileQuery<
  TResult = { [key: string]: any },
  TVariables = { [key: string]: any }
>(
  schema: GraphQLSchema,
  document: TypedDocumentNode<TResult, TVariables>,
  operationName?: string,
  partialOptions?: Partial<CompilerOptions>
): CompiledQuery<TResult, TVariables> | ExecutionResult<TResult> {
  if (!schema) {
    throw new Error(`Expected ${schema} to be a GraphQL schema.`);
  }
  if (!document) {
    throw new Error("Must provide document.");
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

    const type = getOperationRootType(context.schema, context.operation);
    const fieldMap = collectFields(
      context,
      type,
      context.operation.selectionSet,
      Object.create(null),
      Object.create(null)
    );

    const functionBody = compileOperation(context, type, fieldMap);

    const compiledQuery: InternalCompiledQuery = {
      query: createBoundQuery(
        context,
        document,
        // eslint-disable-next-line no-new-func
        new Function("return " + functionBody)(),
        getVariables,
        context.operation.name != null
          ? context.operation.name.value
          : undefined
      ),
      stringify
    };

    if (context.operation.operation === "subscription") {
      compiledQuery.subscribe = createBoundSubscribe(
        context,
        document,
        compileSubscriptionOperation(
          context,
          type,
          fieldMap,
          compiledQuery.query
        ),
        getVariables,
        context.operation.name != null
          ? context.operation.name.value
          : undefined
      );
    }

    if ((options as any).debug) {
      // result of the compilation useful for debugging issues
      // and visualization tools like try-jit.
      compiledQuery.__DO_NOT_USE_THIS_OR_YOU_WILL_BE_FIRED_compilation =
        functionBody;
    }
    return compiledQuery as CompiledQuery<TResult, TVariables>;
  } catch (err: any) {
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
  func: (context: ExecutionContext) => Promise<any> | undefined,
  getVariableValues: (inputs: { [key: string]: any }) => CoercedVariableValues,
  operationName?: string
) {
  const { resolvers, typeResolvers, isTypeOfs, serializers, resolveInfos } =
    compilationContext;
  const trimmer = createNullTrimmer(compilationContext);
  const fnName = operationName || "query";

  /* eslint-disable */
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
  /* eslint-enable */
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
      const executionContext: ExecutionContext = {
        rootValue,
        context,
        variables: parsedVariables.coerced,
        safeMap,
        inspect,
        GraphQLError: GraphqlJitError,
        resolvers,
        typeResolvers,
        isTypeOfs,
        serializers,
        resolveInfos,
        trimmer,
        promiseCounter: 0,
        data: {},
        nullErrors: [],
        errors: []
      };
      // eslint-disable-next-line no-useless-call
      const result = func.call(null, executionContext);
      if (isPromise(result)) {
        return result.then(postProcessResult);
      }
      return postProcessResult(executionContext);
    }
  };

  return ret[fnName];
}

function postProcessResult({
  data,
  nullErrors,
  errors,
  trimmer
}: ExecutionContext) {
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
function compileOperation(
  context: CompilationContext,
  type: GraphQLObjectType,
  fieldMap: FieldsAndNodes
) {
  const serialExecution = context.operation.operation === "mutation";
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
  if (serialExecution) {
    body += `${GLOBAL_EXECUTION_CONTEXT}.queue = [];`;
  }
  body += generateUniqueDeclarations(context, true);
  body += `${GLOBAL_DATA_NAME} = ${topLevel}\n`;
  if (serialExecution) {
    body += compileDeferredFieldsSerially(context);
    body += `
    ${GLOBAL_EXECUTION_CONTEXT}.finalResolve = () => {};
    ${GLOBAL_RESOLVE} = (context) => {
      if (context.jobCounter >= context.queue.length) {
        // All mutations have finished
        context.finalResolve(context);
        return;
      }
      context.queue[context.jobCounter++](context);
    };
    // There might not be a job to run due to invalid queries
    if (${GLOBAL_EXECUTION_CONTEXT}.queue.length > 0) {
      ${GLOBAL_EXECUTION_CONTEXT}.jobCounter = 1; // since the first one will be run manually
      ${GLOBAL_EXECUTION_CONTEXT}.queue[0](${GLOBAL_EXECUTION_CONTEXT});
    }
    // Promises have been scheduled so a new promise is returned
    // that will be resolved once every promise is done
    if (${GLOBAL_PROMISE_COUNTER} > 0) {
      return new Promise(resolve => ${GLOBAL_EXECUTION_CONTEXT}.finalResolve = resolve);
    }
  `;
  } else {
    body += compileDeferredFields(context);
    body += `
    // Promises have been scheduled so a new promise is returned
    // that will be resolved once every promise is done
    if (${GLOBAL_PROMISE_COUNTER} > 0) {
      return new Promise(resolve => ${GLOBAL_RESOLVE} = resolve);
    }`;
  }
  body += `
  // sync execution, the results are ready
  return undefined;
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
 * @returns {string} compiled transformations all of deferred nodes
 */
function compileDeferredFields(context: CompilationContext): string {
  let body = "";
  context.deferred.forEach((deferredField, index) => {
    body += `
      if (${SAFETY_CHECK_PREFIX}${index}) {
        ${compileDeferredField(context, deferredField)}
      }`;
  });
  return body;
}

function compileDeferredField(
  context: CompilationContext,
  deferredField: DeferredField,
  appendix?: string
): string {
  const {
    name,
    originPaths,
    destinationPaths,
    fieldNodes,
    fieldType,
    fieldName,
    jsFieldName,
    responsePath,
    parentType,
    args
  } = deferredField;

  const subContext = createSubCompilationContext(context);
  const nodeBody = compileType(
    subContext,
    parentType,
    fieldType,
    fieldNodes,
    [jsFieldName],
    [`${GLOBAL_PARENT_NAME}.${name}`],
    responsePath
  );
  const parentIndexes = getParentArgIndexes(context);
  const resolverName = getResolverName(parentType.name, fieldName);
  const resolverHandler = getHoistedFunctionName(
    context,
    `${name}${resolverName}Handler`
  );
  const topLevelArgs = getArgumentsName(resolverName);
  const validArgs = getValidArgumentsVarName(resolverName);
  const executionError = createErrorObject(
    context,
    fieldNodes,
    responsePath,
    "err.message != null ? err.message : err",
    "err"
  );
  const executionInfo = getExecutionInfo(
    subContext,
    parentType,
    fieldType,
    fieldName,
    fieldNodes,
    responsePath
  );
  const emptyError = createErrorObject(context, fieldNodes, responsePath, '""');
  const resolverParentPath = originPaths.join(".");
  const resolverCall = `${GLOBAL_EXECUTION_CONTEXT}.resolvers.${resolverName}(
          ${resolverParentPath},${topLevelArgs},${GLOBAL_CONTEXT_NAME}, ${executionInfo})`;
  const resultParentPath = destinationPaths.join(".");
  const compiledArgs = compileArguments(
    subContext,
    args,
    topLevelArgs,
    validArgs,
    fieldType,
    responsePath
  );
  const body = `
    ${compiledArgs}
    if (${validArgs} === true) {
      var __value = null;
      try {
        __value = ${resolverCall};
      } catch (err) {
        ${getErrorDestination(fieldType)}.push(${executionError});
      }
      if (${isPromiseInliner("__value")}) {
      ${promiseStarted()}
       __value.then(result => {
        ${resolverHandler}(${GLOBAL_EXECUTION_CONTEXT}, ${resultParentPath}, result, ${parentIndexes});
        ${promiseDone()}
       }, err => {
        if (err) {
          ${getErrorDestination(fieldType)}.push(${executionError});
        } else {
          ${getErrorDestination(fieldType)}.push(${emptyError});
        }
        ${promiseDone()}
       });
      } else {
        ${resolverHandler}(${GLOBAL_EXECUTION_CONTEXT}, ${resultParentPath}, __value, ${parentIndexes});
      }
    }`;
  context.hoistedFunctions.push(`
    function ${resolverHandler}(${GLOBAL_EXECUTION_CONTEXT}, ${GLOBAL_PARENT_NAME}, ${jsFieldName}, ${parentIndexes}) {
      ${generateUniqueDeclarations(subContext)}
      ${GLOBAL_PARENT_NAME}.${name} = ${nodeBody};
      ${compileDeferredFields(subContext)}
      ${appendix || ""}
    }
  `);
  return body;
}

function compileDeferredFieldsSerially(context: CompilationContext): string {
  let body = "";
  context.deferred.forEach((deferredField) => {
    const { name, fieldName, parentType } = deferredField;
    const resolverName = getResolverName(parentType.name, fieldName);
    const mutationHandler = getHoistedFunctionName(
      context,
      `${name}${resolverName}Mutation`
    );
    body += `${GLOBAL_EXECUTION_CONTEXT}.queue.push(${mutationHandler});\n`;
    const appendix = `
    if (${GLOBAL_PROMISE_COUNTER} === 0) {
      ${GLOBAL_RESOLVE}(${GLOBAL_EXECUTION_CONTEXT});
    }
    `;
    context.hoistedFunctions.push(`
      function ${mutationHandler}(${GLOBAL_EXECUTION_CONTEXT}) {
        ${compileDeferredField(context, deferredField, appendix)}
      }
      `);
  });
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
    const parentIndexes = getParentArgIndexes(context);
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
  fieldNodes: JitFieldNode[],
  originPaths: string[],
  destinationPaths: string[],
  responsePath: ObjectPath | undefined,
  errorDestination: string,
  fieldMap: FieldsAndNodes,
  alwaysDefer: boolean
): string {
  const body = genFn();

  // Begin object compilation paren
  body("(");
  if (typeof type.isTypeOf === "function" && !alwaysDefer) {
    context.isTypeOfs[type.name + "IsTypeOf"] = type.isTypeOf;
    body(
      `!${GLOBAL_EXECUTION_CONTEXT}.isTypeOfs["${
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
      )}), null) :`
    );
  }

  // object start
  body("{");

  for (const name of Object.keys(fieldMap)) {
    const fieldNodes = fieldMap[name];
    const field = resolveFieldDef(context, type, fieldNodes);
    if (!field) {
      // Field is invalid, should have been caught in validation
      // but the error is swallowed for compatibility reasons.
      continue;
    }

    // Key of the object
    // `name` is the field name or an alias supplied by the user
    body(`"${name}": `);

    /**
     * Value of the object
     *
     * The combined condition for whether a field should be included
     * in the object.
     *
     * Here, the logical operation is `||` because every fieldNode
     * is at the same level in the tree, if at least "one of" the nodes
     * is included, then the field is included.
     *
     * For example,
     *
     * ```graphql
     * {
     *   foo @skip(if: $c1)
     *   ... { foo @skip(if: $c2) }
     * }
     * ```
     *
     * The logic for `foo` becomes -
     *
     * `compilationFor($c1) || compilationFor($c2)`
     */
    body(`
      (
        ${
          fieldNodes
            .map((it) => it.__internalShouldInclude)
            .filter((it) => it)
            .join(" || ") || /* if(true) - default */ "true"
        }
      )
    `);

    // Inline __typename
    // No need to call a resolver for typename
    if (field === TypeNameMetaFieldDef) {
      // type.name if field is included else undefined - to remove from object
      // during serialization
      body(`? "${type.name}" : undefined,`);
      continue;
    }

    let resolver = field.resolve;
    if (!resolver && alwaysDefer) {
      const fieldName = field.name;
      resolver = (parent) => parent && parent[fieldName];
    }
    if (resolver) {
      context.deferred.push({
        name,
        responsePath: addPath(responsePath, name),
        originPaths,
        destinationPaths,
        parentType: type,
        fieldName: field.name,
        jsFieldName: getJsFieldName(field.name),
        fieldType: field.type,
        fieldNodes,
        args: getArgumentDefs(field, fieldNodes[0])
      });
      context.resolvers[getResolverName(type.name, field.name)] = resolver;
      body(
        `
          ? (
              ${SAFETY_CHECK_PREFIX}${context.deferred.length - 1} = true,
              null
            )
          : (
              ${SAFETY_CHECK_PREFIX}${context.deferred.length - 1} = false,
              undefined
            )
        `
      );
    } else {
      // if included
      body("?");
      body(
        compileType(
          context,
          type,
          field.type,
          fieldNodes,
          originPaths.concat(field.name),
          destinationPaths.concat(name),
          addPath(responsePath, name)
        )
      );
      // if not included
      body(": undefined");
    }
    // End object property
    body(",");
  }

  // End object
  body("}");
  // End object compilation paren
  body(")");

  return body.toString();
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
    .map((objectType) => {
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
  const nullTypeError = `"Runtime Object type is not a possible type for \\"${type.name}\\"."`;
  /* eslint-disable max-len */
  const notPossibleTypeError =
    // eslint-disable-next-line no-template-curly-in-string
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
  /* eslint-enable max-len */
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
    ["__currentItem"],
    [`${GLOBAL_PARENT_NAME}[idx${newDepth}]`],
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
  const emptyError = createErrorObject(context, fieldNodes, responsePath, '""');
  const uniqueDeclarations = generateUniqueDeclarations(listContext);
  const deferredFields = compileDeferredFields(listContext);
  const itemHandler = getHoistedFunctionName(
    context,
    `${parentType.name}${originalObjectPaths.join("")}MapItemHandler`
  );
  const childIndexes = getParentArgIndexes(listContext);
  listContext.hoistedFunctions.push(`
  function ${itemHandler}(${GLOBAL_EXECUTION_CONTEXT}, ${GLOBAL_PARENT_NAME}, __currentItem, ${childIndexes}) {
    ${uniqueDeclarations}
    ${GLOBAL_PARENT_NAME}[idx${newDepth}] = ${dataBody};
    ${deferredFields}
  }
  `);
  const safeMapHandler = getHoistedFunctionName(
    context,
    `${parentType.name}${originalObjectPaths.join("")}MapHandler`
  );
  const parentIndexes = getParentArgIndexes(context);
  listContext.hoistedFunctions.push(`
  function ${safeMapHandler}(${GLOBAL_EXECUTION_CONTEXT}, __currentItem, idx${newDepth}, resultArray, ${parentIndexes}) {
    if (${isPromiseInliner("__currentItem")}) {
      ${promiseStarted()}
      __currentItem.then(result => {
        ${itemHandler}(${GLOBAL_EXECUTION_CONTEXT}, resultArray, result, ${childIndexes});
        ${promiseDone()}
      }, err => {
        resultArray.push(null);
        if (err) {
          ${getErrorDestination(fieldType)}.push(${executionError});
        } else {
          ${getErrorDestination(fieldType)}.push(${emptyError});
        }
        ${promiseDone()}
      });
    } else {
       ${itemHandler}(${GLOBAL_EXECUTION_CONTEXT}, resultArray, __currentItem, ${childIndexes});
    }
  }
  `);
  return `(typeof ${name} === "string" || typeof ${name}[Symbol.iterator] !== "function") ?  ${errorCase} :
  ${GLOBAL_SAFE_MAP_NAME}(${GLOBAL_EXECUTION_CONTEXT}, ${name}, ${safeMapHandler}, ${parentIndexes})`;
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
    resultArray: any[],
    ...idx: number[]
  ) => any,
  ...idx: number[]
): any[] {
  let index = 0;
  const result: any[] = [];
  for (const a of iterable) {
    cb(context, a, index, result, ...idx);
    ++index;
  }
  return result;
}

const MAGIC_MINUS_INFINITY =
  "__MAGIC_MINUS_INFINITY__71d4310a_d4a3_4a05_b1fe_e60779d24998";
const MAGIC_PLUS_INFINITY =
  "__MAGIC_PLUS_INFINITY__bb201c39_3333_4695_b4ad_7f1722e7aa7a";
const MAGIC_NAN = "__MAGIC_NAN__57f286b9_4c20_487f_b409_79804ddcb4f8";
const MAGIC_DATE = "__MAGIC_DATE__33a9e76d_02e0_4128_8e92_3530ad3da74d";

function specialValueReplacer(this: any, key: any, value: any) {
  if (Number.isNaN(value)) {
    return MAGIC_NAN;
  }

  if (value === Infinity) {
    return MAGIC_PLUS_INFINITY;
  }

  if (value === -Infinity) {
    return MAGIC_MINUS_INFINITY;
  }

  if (this[key] instanceof Date) {
    return MAGIC_DATE + this[key].getTime();
  }

  return value;
}

function objectStringify(val: any): string {
  return JSON.stringify(val, specialValueReplacer)
    .replace(new RegExp(`"${MAGIC_NAN}"`, "g"), "NaN")
    .replace(new RegExp(`"${MAGIC_PLUS_INFINITY}"`, "g"), "Infinity")
    .replace(new RegExp(`"${MAGIC_MINUS_INFINITY}"`, "g"), "-Infinity")
    .replace(new RegExp(`"${MAGIC_DATE}([^"]+)"`, "g"), "new Date($1)");
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

function getArgumentsName(prefixName: string) {
  return `${prefixName}Args`;
}

function getValidArgumentsVarName(prefixName: string) {
  return `${prefixName}ValidArgs`;
}

function objectPath(topLevel: string, path?: ObjectPath) {
  if (!path) {
    return topLevel;
  }
  let objectPath = topLevel;
  const flattened = flattenPath(path);
  for (const section of flattened) {
    if (section.type === "literal") {
      objectPath += `["${section.key}"]`;
    } else {
      /* istanbul ignore next */
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
function compileArguments(
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
      }" of non-null type "${variable.argument.definition.type.toString()}" must not be null.'`;
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
      }" of required type "${variable.argument.definition.type.toString()}" was provided the variable "$${varName}" which was not provided a runtime value.'`;
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
  defaultValue = false
) {
  return context.deferred
    .map(
      (_, idx) => `
        let ${SAFETY_CHECK_PREFIX}${idx} = ${defaultValue};
      `
    )
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
      .map((p) => p.key)
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
  const serialize = customSerializer || ((val: any) => scalar.serialize(val));
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
    } catch (e: any) {
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
 * @returns {string}
 */
function defaultResolveTypeFn(
  value: any,
  contextValue: any,
  info: GraphQLResolveInfo,
  abstractType: GraphQLAbstractType
): string {
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
        return type.name;
      }
    }
  }

  throw new Error(
    `Could not resolve the object type in possible types of ${abstractType.name} for the value: ` +
      inspect(value)
  );
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
  const fragments: { [key: string]: FragmentDefinitionNode } =
    Object.create(null);
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
    depth: -1,
    variableValues: {},
    errors
  } as unknown as CompilationContext;
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
      ${originalError || "undefined"},
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

function promiseStarted() {
  return `
     // increase the promise counter
     ++${GLOBAL_PROMISE_COUNTER};
  `;
}

function promiseDone() {
  return `
    --${GLOBAL_PROMISE_COUNTER};
    if (${GLOBAL_PROMISE_COUNTER} === 0) {
      ${GLOBAL_RESOLVE}(${GLOBAL_EXECUTION_CONTEXT});
    }
  `;
}

function normalizeErrors(err: Error[] | Error): GraphQLError[] {
  if (Array.isArray(err)) {
    return err.map((e) => normalizeError(e));
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
  // eslint-disable-next-line no-self-compare
  return value === undefined || value !== value;
}

function getParentArgIndexes(context: CompilationContext) {
  let args = "";
  for (let i = 0; i <= context.depth; ++i) {
    if (i > 0) {
      args += ", ";
    }
    args += `idx${i}`;
  }
  return args;
}

function getJsFieldName(fieldName: string) {
  return `${LOCAL_JS_FIELD_NAME_PREFIX}${fieldName}`;
}

export function isAsyncIterable<T = unknown>(
  val: unknown
): val is AsyncIterableIterator<T> {
  return typeof Object(val)[Symbol.asyncIterator] === "function";
}

function compileSubscriptionOperation(
  context: CompilationContext,
  type: GraphQLObjectType,
  fieldMap: FieldsAndNodes,
  queryFn: CompiledQuery["query"]
) {
  const fieldNodes = Object.values(fieldMap)[0];
  const fieldNode = fieldNodes[0];
  const fieldName = fieldNode.name.value;

  const field = resolveFieldDef(context, type, fieldNodes);

  if (!field) {
    throw new GraphQLError(
      `The subscription field "${fieldName}" is not defined.`,
      fieldNodes
    );
  }

  const responsePath = addPath(undefined, fieldName);
  const resolveInfoName = createResolveInfoName(responsePath);

  const subscriber = field.subscribe;

  async function executeSubscription(executionContext: ExecutionContext) {
    const resolveInfo = executionContext.resolveInfos[resolveInfoName](
      executionContext.rootValue,
      executionContext.variables,
      responsePath
    );

    try {
      const eventStream = await subscriber?.(
        executionContext.rootValue,
        executionContext.variables,
        executionContext.context,
        resolveInfo
      );
      if (eventStream instanceof Error) {
        throw eventStream;
      }
      return eventStream;
    } catch (error) {
      throw locatedError(
        error,
        resolveInfo.fieldNodes,
        pathToArray(resolveInfo.path)
      );
    }
  }

  async function createSourceEventStream(executionContext: ExecutionContext) {
    try {
      const eventStream = await executeSubscription(executionContext);

      // Assert field returned an event stream, otherwise yield an error.
      if (!isAsyncIterable(eventStream)) {
        throw new Error(
          "Subscription field must return Async Iterable. " +
            `Received: ${inspect(eventStream)}.`
        );
      }

      return eventStream;
    } catch (error) {
      // If it is a GraphQLError, report it as an ExecutionResult, containing only errors and no data.
      // Otherwise treat the error as a system-class error and re-throw it.
      if (error instanceof GraphQLError) {
        return { errors: [error] };
      }
      throw error;
    }
  }

  return async function subscribe(executionContext: ExecutionContext) {
    const resultOrStream = await createSourceEventStream(executionContext);

    if (!isAsyncIterable(resultOrStream)) {
      return resultOrStream;
    }

    // For each payload yielded from a subscription, map it over the normal
    // GraphQL `execute` function, with `payload` as the rootValue.
    // This implements the "MapSourceToResponseEvent" algorithm described in
    // the GraphQL specification. The `execute` function provides the
    // "ExecuteSubscriptionEvent" algorithm, as it is nearly identical to the
    // "ExecuteQuery" algorithm, for which `execute` is also used.
    // We use our `query` function in place of `execute`
    const mapSourceToResponse = (payload: any) =>
      queryFn(payload, executionContext.context, executionContext.variables);

    return mapAsyncIterator(resultOrStream, mapSourceToResponse);
  };
}

function createBoundSubscribe(
  compilationContext: CompilationContext,
  document: DocumentNode,
  func: (
    context: ExecutionContext
  ) => Promise<AsyncIterableIterator<ExecutionResult> | ExecutionResult>,
  getVariableValues: (inputs: { [key: string]: any }) => CoercedVariableValues,
  operationName: string | undefined
): CompiledQuery["subscribe"] {
  const { resolvers, typeResolvers, isTypeOfs, serializers, resolveInfos } =
    compilationContext;
  const trimmer = createNullTrimmer(compilationContext);
  const fnName = operationName || "subscribe";

  const ret = {
    async [fnName](
      rootValue: any,
      context: any,
      variables: Maybe<{ [key: string]: any }>
    ): Promise<AsyncIterableIterator<ExecutionResult> | ExecutionResult> {
      // this can be shared across in a batch request
      const parsedVariables = getVariableValues(variables || {});

      // Return early errors if variable coercing failed.
      if (failToParseVariables(parsedVariables)) {
        return { errors: parsedVariables.errors };
      }

      const executionContext: ExecutionContext = {
        rootValue,
        context,
        variables: parsedVariables.coerced,
        safeMap,
        inspect,
        GraphQLError: GraphqlJitError,
        resolvers,
        typeResolvers,
        isTypeOfs,
        serializers,
        resolveInfos,
        trimmer,
        promiseCounter: 0,
        nullErrors: [],
        errors: [],
        data: {}
      };

      // eslint-disable-next-line no-useless-call
      return func.call(null, executionContext);
    }
  };

  return ret[fnName];
}

/**
 * Given an AsyncIterable and a callback function, return an AsyncIterator
 * which produces values mapped via calling the callback function.
 */
function mapAsyncIterator<T, U, R = undefined>(
  iterable: AsyncGenerator<T, R, undefined> | AsyncIterable<T>,
  callback: (value: T) => U | Promise<U>
): AsyncGenerator<U, R, undefined> {
  const iterator = iterable[Symbol.asyncIterator]();

  async function mapResult(
    result: IteratorResult<T, R>
  ): Promise<IteratorResult<U, R>> {
    if (result.done) {
      return result;
    }

    try {
      return { value: await callback(result.value), done: false };
    } catch (error) {
      if (typeof iterator.return === "function") {
        try {
          await iterator.return();
        } catch (e) {
          /* ignore error */
        }
      }
      throw error;
    }
  }

  return {
    async next() {
      return mapResult(await iterator.next());
    },
    async return(): Promise<IteratorResult<U, R>> {
      return typeof iterator.return === "function"
        ? mapResult(await iterator.return())
        : { value: undefined as unknown as R, done: true };
    },
    async throw(error?: Error) {
      return typeof iterator.throw === "function"
        ? mapResult(await iterator.throw(error))
        : Promise.reject(error);
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}
