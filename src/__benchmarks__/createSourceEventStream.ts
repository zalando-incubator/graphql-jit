import Benchmark from "benchmark";
import {
  createSourceEventStream,
  GraphQLBoolean,
  GraphQLID,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse

} from "graphql";
import { isPromise } from "../execution";
import { compileSourceEventStream } from "..";

const schema = function schema() {
  const BlogArticle: GraphQLObjectType = new GraphQLObjectType({
    name: "Article",
    fields: {
      id: { type: new GraphQLNonNull(GraphQLID) },
      isPublished: { type: GraphQLBoolean },
      title: { type: GraphQLString },
      body: { type: GraphQLString },
      keywords: { type: new GraphQLList(GraphQLString) }
    }
  });

  const BlogQuery = new GraphQLObjectType({
    name: "Query",
    fields: {
      article: {
        type: BlogArticle,
        args: { id: { type: GraphQLID } },
        resolve: (_, { id }) => article(id)
      },
    }
  });
  const BlogSubscription = new GraphQLObjectType({
    name: "Subscription",
    fields: {
      news: {
        type: BlogArticle,
        args: {},
        subscribe: async () => {
          const it: AsyncIterable<any> = {
            [Symbol.asyncIterator]() {
              return {
                next: async () => ({done: true, value: undefined})
              }
            },
          }
          return it;
        }
      },
    }
  });

  function article(id: number): any {
    return {
      id,
      isPublished: true,
      title: "My Article " + id,
      body: "This is a post",
      hidden: "This data is not exposed in the schema",
      keywords: ["foo", "bar", 1, true, null]
    };
  }

  return new GraphQLSchema({
    query: BlogQuery,
    subscription: BlogSubscription
  });
}()

const subscription = parse(`
subscription {
  news {
    ...articleFields,
  }
}

fragment articleFields on Article {
  __typename
  id,
  isPublished,
  title,
  body,
  hidden,
  notdefined
}
`);

// TODO
const skipJS = false;

export function benchmarkCreateSourceEventStream() {
  const compiledQuery = compileSourceEventStream(schema, subscription, undefined, {
    debug: true
  } as any);
  if (!compiledQuery) {
    // eslint-disable-next-line no-console
    console.error(`failed to compile`);
    return null;
  }
  const suite = new Benchmark.Suite('createSourceEventStream');
  if (!skipJS) {
    suite.add("graphql-js", {
      minSamples: 150,
      defer: true,
      fn(deferred: any) {
        const stream = createSourceEventStream(
          schema,
          subscription,
          {},
        );
        if (isPromise(stream)) {
          return stream.then((res) =>
            deferred.resolve(res)
          );
        }
        return deferred.resolve()
      }
    });
  }
  suite
    .add("graphql-jit", {
      minSamples: 150,
      defer: true,
      fn(deferred: any) {
        const stream = compiledQuery(
          {},
          undefined
        );
        if (isPromise(stream)) {
          return stream.then((res) =>
            deferred.resolve(res)
          );
        }
        return deferred.resolve()
      }
    })
    // add listeners
    .on("cycle", (event: any) => {
      // eslint-disable-next-line no-console
      console.log(String(event.target));
    })
    .on("start", () => {
      // eslint-disable-next-line no-console
      console.log("Starting createSourceEventStream");
    });
  return suite;
}
