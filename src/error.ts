/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/error/GraphQLError.js
 */

import {
  GraphQLError as UpstreamGraphQLError,
  printError,
  SourceLocation
} from "graphql";

export function GraphQLError(
  message: string,
  locations?: ReadonlyArray<SourceLocation>,
  path?: ReadonlyArray<string | number>,
  originalError?: Error & { extensions?: any },
  skipStackCapturing?: boolean
) {
  const extensions = originalError && originalError.extensions;
  Object.defineProperties(this, {
    message: {
      value: message,
      enumerable: true
    },
    locations: {
      value: locations || undefined,
      enumerable: locations && locations.length > 0
    },
    path: {
      value: path || undefined,
      enumerable: Boolean(path)
    },
    originalError: {
      value: originalError
    },
    extensions: {
      // Coercing falsey values to undefined ensures they will not be included
      // in JSON.stringify() when not provided.
      value: extensions || undefined,
      enumerable: Boolean(extensions)
    }
  });

  // Include (non-enumerable) stack trace.
  if (originalError && originalError.stack) {
    Object.defineProperty(this, "stack", {
      value: originalError.stack,
      writable: true,
      configurable: true
    });
  } else if (!skipStackCapturing) {
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GraphQLError);
    } else {
      Object.defineProperty(this, "stack", {
        value: Error().stack,
        writable: true,
        configurable: true
      });
    }
  }
}

(GraphQLError as any).prototype = Object.create(
  UpstreamGraphQLError.prototype,
  {
    constructor: { value: GraphQLError },
    name: { value: "GraphQLError" },
    toString: {
      value: function toString() {
        return printError(this);
      }
    }
  }
);
