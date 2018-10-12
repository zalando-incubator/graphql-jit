import Benchmark from "benchmark";
import {
  execute,
  getIntrospectionQuery,
  GraphQLBoolean,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { compileQuery } from "../";

const schema = getSchema();
const document = parse(getIntrospectionQuery({ descriptions: true }));

const { query: withLeaf }: any = compileQuery(schema, document, "", {
  disableLeafSerialization: false
});
const { query: noLeaf }: any = compileQuery(schema, document, "", {
  disableLeafSerialization: true
});

const suite = new Benchmark.Suite();

suite
  .add("graphql-js", () => {
    execute(schema, document);
  })
  .add("graphql-jit - no leaf", () => {
    noLeaf(undefined, undefined, {});
  })
  .add("graphql-jit - with leaf", () => {
    withLeaf(undefined, undefined, {});
  })
  // add listeners
  .on("cycle", (event: any) => {
    // tslint:disable-next-line
    console.log(String(event.target));
  })
  .on("complete", () => {
    // tslint:disable-next-line
    console.log("Fastest is " + suite.filter("fastest").map("name" as any));
  })
  .run();

function getSchema() {
  const BlogImage = new GraphQLObjectType({
    name: "Image",
    fields: {
      url: { type: GraphQLString },
      width: { type: GraphQLInt },
      height: { type: GraphQLInt }
    }
  });

  const BlogAuthor = new GraphQLObjectType({
    name: "Author",
    fields: () => ({
      id: { type: GraphQLString },
      name: { type: GraphQLString },
      pic: {
        args: { width: { type: GraphQLInt }, height: { type: GraphQLInt } },
        type: BlogImage
      },
      recentArticle: { type: BlogArticle }
    })
  });

  const BlogArticle: GraphQLObjectType = new GraphQLObjectType({
    name: "Article",
    fields: {
      id: { type: new GraphQLNonNull(GraphQLID) },
      isPublished: { type: GraphQLBoolean },
      author: { type: BlogAuthor },
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
        args: { id: { type: GraphQLID } }
      },
      feed: {
        type: new GraphQLList(BlogArticle)
      }
    }
  });

  return new GraphQLSchema({
    query: BlogQuery
  });
}
