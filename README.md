# GraphQL JIT

[![Build](https://github.com/hoangvvo/graphql-jit/actions/workflows/build.yml/badge.svg)](https://github.com/hoangvvo/graphql-jit/actions/workflows/build.yml)
[![codecov](https://codecov.io/gh/hoangvvo/graphql-jit/branch/dev/graph/badge.svg?token=WUU4718LQH)](https://codecov.io/gh/hoangvvo/graphql-jit)

This is a fork of [zalando-incubator/graphql-jit](https://github.com/zalando-incubator/graphql-jit) that features the following improvements:

- Support for GraphQL Subscription
- Custom JSON Stringify factory function

Check out the [original README](https://github.com/zalando-incubator/graphql-jit/blob/master/README.md) to learn more.

## Install

```sh
yarn add @hoangvvo/graphql-jit
// or
npm i @hoangvvo/graphql-jit
```

## Usage

```js
import { compileQuery, isCompiledQuery } from "graphql-jit";

const query = `{ hello }`;

const document = parse(query);

const compiledQuery = compileQuery(schema, document);

if (!isCompiledQuery(compiledQuery)) {
  console.error(compiledQuery);
  throw new Error("Error compiling query");
}

const executionResult = await compiledQuery.query(rootValue, contextValue, variableValues);
console.log(executionResult);
```

## API

### compiledQuery = compileQuery(schema, document, operationName, compilerOptions)

Compiles the `document` AST, using an optional operationName and compiler options.

- `schema` {GraphQLSchema} - `graphql` schema object
- `document` {DocumentNode} - document query AST ,can be obtained by `parse` from `graphql`
- `operationName` {string} - optional operation name in case the document contains multiple [operations](http://spec.graphql.org/draft/#sec-Language.Operations)(queries/mutations/subscription).
- `compilerOptions` {Object} - Configurable options for the compiler

  - `disableLeafSerialization` {boolean, default: false} - disables leaf node serializers. The serializers validate the content of the field at runtime
    so this option should only be set to true if there are strong assurances that the values are valid.
  - `customSerializers` {Object as Map, default: {}} - Replace serializer functions for specific types. Can be used as a safer alternative
    for overly expensive serializers
  - `customJSONSerializer` {function, default: undefined} - A function to be called with [`CompilationContext`](https://github.com/zalando-incubator/graphql-jit/blob/master/src/execution.ts#L87) to produce also a JSON serializer function. The default stringifier function is `JSON.stringify`

#### compiledQuery.query(root: any, context: any, variables: Maybe<{ [key: string]: any }>)

the compiled function that can be called with a root value, a context and the required variables.

#### compiledQuery.stringify(value: any)

the compiled function for producing a JSON string. It will be `JSON.stringify` unless `compilerOptions.customJSONSerializer` is a function.
The value argument should be the return of the compiled GraphQL function.

## LICENSE

MIT
