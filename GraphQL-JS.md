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
