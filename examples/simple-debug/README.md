# Simple graphql-jit debugging example

This small server compiles the GraphQL query from each request into separate
virtual JavaScript sources for its executor and variable coercer. It formats both with the
user-supplied `@prettier/sync` formatter before compiling them.

## Run

From the repository root:

```sh
yarn build
node --inspect-brk examples/simple-debug/server.js
```

Attach VS Code's Node debugger, then continue execution. The server listens on
<http://localhost:8001/graphql>.

Make a request in another terminal:

```sh
curl --request POST http://localhost:8001/graphql \
  --header 'content-type: application/json' \
  --data '{
    "query": "query Greeting($name: String!) { greeting(name: $name) }",
    "variables": { "name": "GraphQL-JIT" }
  }'
```

The request stops at the `debugger;` statement in `server.js`, immediately
before graphql-jit executes its compiled query. In VS Code's **Loaded Scripts**
view, open either generated source:

```text
graphql-jit://graphql-jit/debug-example/Greeting.query.js
graphql-jit://graphql-jit/debug-example/Greeting.variables.js
```

Set a breakpoint in either source, continue the current request, and send a
second request if necessary. The virtual source name comes from the operation
name, so this request uses `Greeting.query.js` and `Greeting.variables.js`.
