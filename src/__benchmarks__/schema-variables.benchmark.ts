import Benchmark from "benchmark";
import {
  execute,
  // execute,
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
const document = parse(`
query ($id: ID! = "1", $width: Int = 640, $height: Int = 480){
  feed {
    __typename
    id,
    title
  },
  article(id: $id) {
    ...articleFields,
    author {
      __typename
      id,
      name,
      pic(width: $width, height: $height) {
      __typename
        url,
        width,
        height
      },
      recentArticle {
        ...articleFields,
        keywords
      }
    }
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

const { query: compilerParserNoLeaf }: any = compileQuery(
  schema,
  document,
  "",
  {
    disableLeafSerialization: true
  }
);
const compilerParser: any = compileQuery(schema, document, "");
const vars = { id: "1" };

const suite = new Benchmark.Suite();

suite
  .add("graphql-js", {
    defer: true,
    fn(deferred: any) {
      const p: any = execute(schema, document, undefined, undefined, vars);
      p.then(() => deferred.resolve());
    }
  })
  .add("graphql-jit", {
    defer: true,
    fn(deferred: any) {
      compilerParser
        .query(undefined, undefined, vars)
        .then(() => deferred.resolve());
    }
  })
  .add("graphql-jit - no leaf", {
    defer: true,
    fn(deferred: any) {
      compilerParserNoLeaf(undefined, undefined, vars).then(() =>
        deferred.resolve()
      );
    }
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
        type: BlogImage,
        resolve: (obj, { width, height }) => obj.pic(width, height)
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
      title: {
        type: GraphQLString,
        resolve: article => Promise.resolve(article && article.title)
      },
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
      feed: {
        type: new GraphQLList(BlogArticle),
        resolve: () =>
          Promise.resolve([
            article(1),
            article(2),
            article(3),
            article(4),
            article(5),
            article(6),
            article(7),
            article(8),
            article(9),
            article(10)
          ])
      }
    }
  });

  const johnSmith = {
    id: 123,
    name: "John Smith",
    pic: (width: number, height: number) => getPic(123, width, height),
    recentArticle: null
  };
  johnSmith.recentArticle = article(1);

  function article(id: number): any {
    return {
      id,
      isPublished: true,
      author: johnSmith,
      title: "My Article " + id,
      body: "This is a post",
      hidden: "This data is not exposed in the schema",
      keywords: ["foo", "bar", 1, true, null]
    };
  }
  function getPic(uid: number, width: number, height: number) {
    return {
      url: `cdn://${uid}`,
      width: `${width}`,
      height: `${height}`
    };
  }

  return new GraphQLSchema({
    query: BlogQuery
  });
}
