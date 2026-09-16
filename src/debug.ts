export interface CompilerDebugOptions {
  /** Enables debug-compatible source generation */
  enabled: boolean;

  /**
   * Name shown for the generated query executor in JavaScript debuggers.
   *
   * This is normally a virtual URL, for example
   * `graphql-jit://graphql-jit/my-service/GetUser.query.js`.
   */
  querySourceName?: string;

  /**
   * Name shown for the generated variable coercer in JavaScript debuggers.
   *
   * This is normally a virtual URL, for example
   * `graphql-jit://graphql-jit/my-service/GetUser.variables.js`.
   */
  variablesSourceName?: string;

  /**
   * Formats generated source before it is compiled.
   *
   * The formatter must return a string synchronously. For example,
   * applications can use `@prettier/sync` in development.
   */
  formatSourceCode?: (source: string) => string;
}

export function normalizeDebugOptions(
  debug: CompilerDebugOptions | undefined
): CompilerDebugOptions | undefined {
  if (!debug || !debug.enabled) {
    return undefined;
  }
  if (/\r|\n/.test(debug.querySourceName || "")) {
    throw new Error("debug.querySourceName must not contain a line break.");
  }
  if (/\r|\n/.test(debug.variablesSourceName || "")) {
    throw new Error("debug.variablesSourceName must not contain a line break.");
  }
  if (
    debug.formatSourceCode !== undefined &&
    typeof debug.formatSourceCode !== "function"
  ) {
    throw new Error("debug.formatSourceCode must be a function.");
  }
  return debug;
}

export function formatDebugSource(
  source: string,
  formatSourceCode: CompilerDebugOptions["formatSourceCode"]
): string {
  if (!formatSourceCode) {
    return source;
  }
  const formattedSource = formatSourceCode(source);
  if (typeof formattedSource !== "string") {
    throw new Error(
      "debug.formatSourceCode must return a string synchronously."
    );
  }
  return formattedSource;
}

export function appendSourceURL(source: string, sourceName: string): string {
  return `${source}\n//# sourceURL=${sourceName}`;
}

export function createGeneratedSourceName(
  operationName: string | undefined,
  options: CompilerDebugOptions,
  compilation: "query" | "variables"
): string {
  const configuredSourceName =
    compilation === "query"
      ? options.querySourceName
      : options.variablesSourceName;
  if (configuredSourceName) {
    return configuredSourceName;
  }
  const operation = encodeURIComponent(operationName || "anonymous");
  return `graphql-jit://graphql-jit/operation/${operation}.${compilation}.js`;
}
