# GraphQL JIT

[![Build Status](https://travis-ci.org/zalando-incubator/graphql-jit.svg?branch=master)](https://travis-ci.org/zalando-incubator/graphql-jit)
[![codecov](https://codecov.io/gh/zalando-incubator/graphql-jit/branch/master/graph/badge.svg)](https://codecov.io/gh/zalando-incubator/graphql-jit)

### Why?

GraphQL-JS is a very well written runtime implementation of the latest GraphQL spec. However, by compiling to JS, V8 is able to create optimized
code which yields much better performance. `graphql-jit` leverages this behaviour of V8 optimization by compiling the queries into functions to significantly improve performance (See [benchmarks](#benchmarks) below)

#### Benchmarks

```bash
$ yarn benchmark skip-json
Starting introspection
graphql-js x 1,155 ops/sec ±1.55% (215 runs sampled)
graphql-jit x 5,961 ops/sec ±5.34% (216 runs sampled)
Starting fewResolvers
graphql-js x 14,313 ops/sec ±1.43% (224 runs sampled)
graphql-jit x 409,587 ops/sec ±1.08% (216 runs sampled)
Starting manyResolvers
graphql-js x 13,201 ops/sec ±1.50% (216 runs sampled)
graphql-jit x 229,025 ops/sec ±1.18% (216 runs sampled)
Starting nestedArrays
graphql-js x 108 ops/sec ±1.30% (216 runs sampled)
graphql-jit x 1,317 ops/sec ±2.38% (213 runs sampled)
Done in 141.94s.
```

### Support for GraphQL spec

The goal is to support the [June 2018 version of the GraphQL spec](https://facebook.github.io/graphql/June2018/). At this moment,
the only missing feature is support for Subscriptions.

#### Differences to `graphql-js`

In order to achieve better performance, the `graphql-jit` compiler introduces some limitations.
The primary limitation is that all computed properties must have a resolver and only these can return a `Promise`.

## Install

```sh
yarn add graphql-jit
```

## Example

For complete working examples, check the [examples/](examples) directory

#### Create a schema

```js
const typedefs = `
type Query {
  hello: string
}
`;
const resolvers = {
  Query: {
    hello() {
      return new Promise(resolve => setTimeout(() => resolve("World!"), 200));
    }
  }
};

const { makeExecutableSchema } = require("graphql");
const schema = makeExecutableSchema({ typedefs, resolvers });
```

#### Compile a Query

```js
const query = `
{
  hello
}
`;
const { parse } = require("graphql");
const document = parse(query);

const { compileQuery, isCompiledQuery } = require("graphql-jit");
const compiledQuery = compileQuery(schema, document);
// check if the compilation is successful

if (!isCompiledQuery(compiledQuery)) {
  console.error(compiledQuery);
  throw new Error("Error compiling query");
}
```

#### Execute the Query

```js
const executionResult = await compiledQuery.query();
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
  - `customJSONSerializer` {boolean, default: false} - Whether to produce also a JSON serializer function using `fast-json-stringify`. The default stringifier function is `JSON.stringify`

#### compiledQuery.compiled(root: any, context: any, variables: Maybe<{ [key: string]: any }>)

the compiled function that can be called with a root value, a context and the required variables.

#### compiledQuery.stringify(value: any)

the compiled function for producing a JSON string. It will be `JSON.stringify` unless `compilerOptions.customJSONSerializer` is true.
The value argument should the return of the compiled GraphQL function.

## LICENSE

MIT
