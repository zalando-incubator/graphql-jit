# Blog

An example blog schema using GraphQL-Jit implementing the concepts of [persisted-queries][apollo-pq]

## Compile

From anywhere inside the project root,

```sh
yarn tsc -p examples/blog
```

## Run Server

From the current directory,

```sh
node dist/server.js
```

or from the root directory,

```sh
node examples/blog/dist/server.js
```

## Executing Query

### Persist

Learn more about persisted queries from the [Apollo Blog post][apollo-pq]

Persist a query,

- Validates and Compiles the query using graphql-jit and stores it in memory

```sh
curl localhost:8000/persist -d 'query { post(id: "post:1") { title author { name } } }'
```

will return an id

```
9c4d10bd4a0c315c22aa5f2b8d0fcfbd09781454bad306dba93b65a937334453
```

### Execute

You can now use the above id and execute the persisted query,

```sh
curl localhost:8000/graphql -d '{ "id": "9c4d10bd4a0c315c22aa5f2b8d0fcfbd09781454bad306dba93b65a937334453" }'
```

[apollo-pq]: https://blog.apollographql.com/persisted-graphql-queries-with-apollo-client-119fd7e6bba5
