# GraphQL JIT


[![Build Status](https://travis-ci.org/ruiaraujo/graphql-jit.svg?branch=master)](https://travis-ci.org/ruiaraujo/graphql-jit)
[![codecov](https://codecov.io/gh/ruiaraujo/graphql-jit/branch/master/graph/badge.svg)](https://codecov.io/gh/ruiaraujo/graphql-jit)


### Why?

GraphQL-JS is a very well written runtime implementation of the latest GraphQL spec. However, by compiling to JS, V8 is able to create optimized
code while yields much better performance.

### Support

The goal is to support the [June 2018 version of the GraphQL spec](https://facebook.github.io/graphql/June2018/). At this moment,
the only missing feature is support for the @skip and @include directives.

#### Differences to graphql-js

In order to achieve better performance, the compiler introduces some limitations.
The main one is that all computed properties must have a resolver and only these can return a Promise.

## Install

```sh
yarn add graphql-jit
```

## Usage

This is an example of a handler that could be used with ```express``` or ```micro```.

```js
const httpErrors = require('http-errors');
const {getGraphQLParams} = require("express-graphql");
const graphql = require('graphql');
const LRU = require("lru-cache");
const {compileQuery} = require("graphql-jit");


module.exports = function setupHandler(schema) {
    const cache = LRU({max: 100});
    return function graphqlMiddleware(request, response) {
        // Promises are used as a mechanism for capturing any thrown errors during
        // the asynchronous process below.

        // Parse the Request to get GraphQL request parameters.
        return getGraphQLParams(request).then(function (graphQLParams) {

            // Collect information from the options data object.
            let context = request;
            let rootValue = undefined;

            let validationRules = graphql.specifiedRules;

            // GraphQL HTTP only supports GET and POST methods.
            if (request.method !== 'GET' && request.method !== 'POST') {
                response.setHeader('Allow', 'GET, POST');
                throw httpErrors(405, 'GraphQL only supports GET and POST requests.');
            }

            // Get GraphQL params from the request and POST body data.
            const query = graphQLParams.query;
            const variables = graphQLParams.variables;
            const operationName = graphQLParams.operationName;

            // If there is no query, but GraphiQL will be displayed, do not produce
            // a result, otherwise return a 400: Bad Request.
            if (!query) {
                throw httpErrors(400, 'Must provide query string.');
            }
            let cached = cache.get(query + operationName);
            if (!cached) {
                // GraphQL source.
                let source = new graphql.Source(query, 'GraphQL request');
                let documentAST;
                // Parse source to AST, reporting any syntax error.
                try {
                    documentAST = graphql.parse(source);
                } catch (syntaxError) {
                    // Return 400: Bad Request if any syntax errors errors exist.
                    response.statusCode = 400;
                    return {errors: [syntaxError]};
                }

                // Validate AST, reporting any errors.
                let validationErrors = graphql.validate(schema, documentAST, validationRules);
                if (validationErrors.length > 0) {
                    // Return 400: Bad Request if any validation errors exist.
                    response.statusCode = 400;
                    return {errors: validationErrors};
                }

                // Only query operations are allowed on GET requests.
                if (request.method === 'GET') {
                    // Determine if this GET request will perform a non-query.
                    let operationAST = graphql.getOperationAST(documentAST, operationName);
                    if (operationAST && operationAST.operation !== 'query') {

                        // Otherwise, report a 405: Method Not Allowed error.
                        response.setHeader('Allow', 'POST');
                        throw httpErrors(405, 'Can only perform a ' + operationAST.operation + ' operation ' + 'from a POST request.');
                    }
                }

                cached = compileQuery(schema, documentAST, operationName, {customSerializers: {ID: String, String: String}});
                cache.set(query + operationName, cached)
            }

            // Perform the execution, reporting any errors creating the context.
            try {
                return cached.query(rootValue, context, variables);
            } catch (contextError) {
                // Return 400: Bad Request if any execution context errors exist.
                response.statusCode = 400;
                return {errors: [contextError]};
            }
        }).catch(function (error) {
            // If an error was caught, report the httpError status, or 500.
            response.statusCode = error.status || 500;
            return {errors: [error]};
        }).then(function (result) {
            // If no data was included in the result, that indicates a runtime query
            // error, indicate as such with a generic status code.
            // Note: Information about the error itself will still be contained in
            // the resulting JSON payload.
            // http://facebook.github.io/graphql/#sec-Data
            if (response.statusCode === 200 && result && !result.data) {
                response.statusCode = 500;
            }
            // Format any encountered errors.
            if (result && result.errors) {
                result.errors = result.errors.map(graphql.formatError);
            }
            // At this point, result is guaranteed to exist, as the only scenario
            // where it will not is when showGraphiQL is true.
            if (!result) {
                throw httpErrors(500, 'Internal Error');
            }

            return result
        });
    };

}


```

## API

### compiledQuery = compileQuery(schema, document, operationName, compilerOptions)

Compiles the `document` AST, using an optional operationName and  compiler options.

- `schema` {GraphQLSchema} - `graphql-js` schema object
- `document` {DocumentNode} - document query AST ,can be obtained by `parse` from  `graphql-js` 
- `operationName` {string} - optional operation name in case the document contains multiple queries/operations.
- `compilerOptions` {Object} - Configurable options on the agent pool

  - `disableLeafSerialization` {boolean, default: false} - disables leaf node serializers. The serializers validate the content of the field 
  so this option should only be set to true if there are strong assurances that the values are valid.
  - `customSerializers` {Object as Map, default: {}} - Replace serializer functions for specific types. Can be used as a safer alternative 
  for overly expensive 
  - `customJSONSerializer` {boolean, default: false} - Whether to produce also a JSON serializer function using `fast-json-stringify`,
  otherwise the stringify function is just `JSON.stringify` 

#### compiledQuery.compiled(root: any, context: any, variables: Maybe<{ [key: string]: any }>)

the compiled function that can be called with a root value, a context and the required variables.

#### compiledQuery.stringify(value: any)

the compiled function for producing a JSON string. It will be `JSON.stringify` unless `compilerOptions.customJSONSerializer` is true.
The value argument should the return of the compiled GraphQL function.

## LICENSE

MIT
