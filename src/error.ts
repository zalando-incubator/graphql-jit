/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import {GraphQLError as UpstreamGraphQLError, printError, SourceLocation} from "graphql";

export function GraphQLError(
        message: string,
        locations?: ReadonlyArray<SourceLocation>,
        path?: ReadonlyArray<string | number>,
        originalError?: Error & { extensions?: any }
    ) {
        const extensions = originalError && originalError.extensions;
        Object.defineProperties(this, {
            message: {
                value: message,
                enumerable: true,
            },
            locations: {
                value: locations || undefined,
                enumerable: Boolean(locations),
            },
            path: {
                value: path || undefined,
                enumerable: Boolean(path),
            },
            originalError: {
                value: originalError,
            },
            extensions: {
                // Coercing falsey values to undefined ensures they will not be included
                // in JSON.stringify() when not provided.
                value: extensions || undefined,
                enumerable: Boolean(extensions),
            },
        });

        // Include (non-enumerable) stack trace.
        if (originalError && originalError.stack) {
            Object.defineProperty(this, "stack", {
                value: originalError.stack,
                writable: true,
                configurable: true,
            });
        } else if (Error.captureStackTrace) {
            Error.captureStackTrace(this, GraphQLError);
        } else {
            Object.defineProperty(this, "stack", {
                value: Error().stack,
                writable: true,
                configurable: true,
            });
        }
}

(GraphQLError as any).prototype = Object.create(UpstreamGraphQLError.prototype, {
    constructor: { value: GraphQLError },
    name: { value: "GraphQLError" },
    toString: {
        value: function toString() {
            return printError(this);
        },
    },
});
