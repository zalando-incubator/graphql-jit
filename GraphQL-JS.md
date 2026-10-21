## Differences to GraphQL-JS

In order to achieve better performance, the `graphql-jit` compiler introduces some limitations.
The primary limitation is that all computed properties must have a resolver and only these can return a `Promise`.

JIT treats the Promise objects at non-computed properties as values and does not await them. So, in such cases, the return value in GraphQL-JIT would be `null`, whereas in GraphQL-JS it would be the awaited value of the Promise.

Note: This is not to be confused with async resolvers. Async resolvers are supported and awaited by both GraphQL-JS and GraphQL-JIT.

As an example of this limitation, consider the following schema and resolvers:

```graphql
type Query {
  foo: Foo
}
type Foo {
  bar: String
}
```

```ts
const resolvers = {
  Query: {
    // Promise returning functions are supported in both GraphQL-JS and GraphQL-JIT
    async foo() {
      await Promise.resolve();

      return {
        // The following Promise is not supported by GraphQL-JIT
        // without a resolver defined for bar
        // like the commented out resolver below
        bar: Promise.resolve("bar")
      };
    }
  },
  Foo: {
    // An example resolver that would make GraphQL-JIT
    // await the Promise at value bar.
    //
    // bar(parent) {
    //   return parent.bar;
    // }
  }
};
```

### Input values

Argument literals are coerced once, when the query is compiled. Lists and input objects are rebuilt for every execution, but the values returned by custom scalars are reused. This leads to a few differences.

#### Custom scalar literals are parsed once

`parseLiteral` (or `coerceInputLiteral`) runs at compile time, not on every execution, and the returned value is shared between executions. Resolvers should not mutate such values.

```ts
const DateTime = new GraphQLScalarType({
  name: "DateTime",
  parseLiteral: (node) => new Date(node.value)
  // ...
});

const resolvers = {
  Query: {
    nextDay(_, { date }) {
      // Mutates the Date shared by every execution of the compiled query.
      // Use `new Date(date)` and mutate the copy instead.
      date.setDate(date.getDate() + 1);
      return date.toISOString().slice(0, 10);
    }
  }
};
```

```graphql
{
  nextDay(date: "2024-01-01")
}
```

| Execution | GraphQL-JS   | GraphQL-JIT  |
| --------- | ------------ | ------------ |
| 1st       | `2024-01-02` | `2024-01-02` |
| 2nd       | `2024-01-02` | `2024-01-03` |
| 3rd       | `2024-01-02` | `2024-01-04` |

An invalid literal fails compilation instead of producing a field error. GraphQL validation reports these before execution anyway.

#### Variables inside custom scalar literals are not substituted

When a custom scalar such as `JSON` is written as a literal containing variables, the scalar does not receive the values of those variables.

```graphql
query ($v: String) {
  echo(value: { x: $v }) # value is a JSON scalar
}
```

With `{ "v": "hi" }`, GraphQL-JS passes `{ x: "hi" }` to the resolver, while GraphQL-JIT passes `{ x: undefined }`. Pass the whole value as a variable instead:

```graphql
query ($json: JSON) {
  echo(value: $json)
}
```
