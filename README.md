# GraphQL JIT

![npm](https://img.shields.io/npm/dw/graphql-jit)
[![codecov](https://codecov.io/gh/zalando-incubator/graphql-jit/branch/main/graph/badge.svg)](https://codecov.io/gh/zalando-incubator/graphql-jit)

### Why?

GraphQL-JS is a very well written runtime implementation of the latest GraphQL spec. However, by compiling to JS, V8 is able to create optimized
code which yields much better performance. `graphql-jit` leverages this behaviour of V8 optimization by compiling the queries into functions to significantly improve performance (See [benchmarks](#benchmarks) below)

#### Benchmarks

GraphQL-JS 16 on Node 16.13.0
```bash
$ yarn benchmark skip-json
Starting introspection
graphql-js x 1,941 ops/sec ±2.50% (225 runs sampled)
graphql-jit x 6,158 ops/sec ±2.38% (222 runs sampled)
Starting fewResolvers
graphql-js x 26,620 ops/sec ±2.41% (225 runs sampled)
graphql-jit x 339,223 ops/sec ±2.94% (215 runs sampled)
Starting manyResolvers
graphql-js x 16,415 ops/sec ±2.36% (220 runs sampled)
graphql-jit x 178,331 ops/sec ±2.73% (221 runs sampled)
Starting nestedArrays
graphql-js x 127 ops/sec ±1.43% (220 runs sampled)
graphql-jit x 1,316 ops/sec ±2.58% (219 runs sampled)
Done in 141.25s.
```

### Support for GraphQL spec

The goal is to support the [June 2018 version of the GraphQL spec](https://facebook.github.io/graphql/June2018/).

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
const typeDefs = `
type Query {
  hello: String
}
`;
const resolvers = {
  Query: {
    hello() {
      return new Promise(resolve => setTimeout(() => resolve("World!"), 200));
    }
  }
};

const { makeExecutableSchema } = require("@graphql-tools/schema");
const schema = makeExecutableSchema({ typeDefs, resolvers });
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
const executionResult = await compiledQuery.query(root, context, variables);
console.log(executionResult);
```

#### Subscribe to the Query

```js
const result = await compiledQuery.subscribe(root, context, variables);
for await (const value of result) {
  console.log(value);
}
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

#### compiledQuery.query(root: any, context: any, variables: Maybe<{ [key: string]: any }>)

the compiled function that can be called with a root value, a context and the required variables.

#### compiledQuery.subscribe(root: any, context: any, variables: Maybe<{ [key: string]: any }>)

(available for GraphQL Subscription only) the compiled function that can be called with a root value, a context and the required variables to produce either an AsyncIterator (if successful) or an ExecutionResult (error).

#### compiledQuery.stringify(value: any)

the compiled function for producing a JSON string. It will be `JSON.stringify` unless `compilerOptions.customJSONSerializer` is true.
The value argument should be the return of the compiled GraphQL function.

## LICENSE

MIT
