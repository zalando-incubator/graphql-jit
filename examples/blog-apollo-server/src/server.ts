import { ApolloServer, makeExecutableSchema } from "apollo-server";
import { readFileSync } from "fs";
import path from "path";
import { executor } from "./executor";
import resolvers from "./resolvers";

const schema = makeExecutableSchema({
  typeDefs: readFileSync(path.join(__dirname, "../schema.gql"), "utf-8"),
  resolvers
});
const apollo = new ApolloServer({
  schema,
  executor: executor(schema)
});

apollo.listen({ port: 3000 }).then(() => {
  console.log("Go to http://localhost:3000/graphql to run queries!");
});
