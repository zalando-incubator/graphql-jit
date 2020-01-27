# Blog-apollo-server

An example blog schema using GraphQL-Jit as custom executor for [Apollo Server](https://github.com/apollographql/apollo-server).

## Running

From the current directory.

```sh
yarn install
ts-node src/server
```

## Executing Query

Go to `http://localhost:3000/graphql` to run queries.

Sample query:
```
query {
  post(id: "post:1") {
    title
    author {
      name
    }
  }
}
```
