import {
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
import { Histogram } from "metrics";
import { compileQuery } from "../";

const schema = getSchema();
const document = parse(`
{
  feed {
    id,
    title
  },
  article(id: "1") {
    ...articleFields,
    author {
      id,
      name,
      pic(width: 640, height: 480) {
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
  id,
  isPublished,
  title,
  body,
  hidden,
  notdefined
}
`);
type seconds = number;
type nanoseconds = number;
type milliseconds = number;

function getMillisecs(startTime: [seconds, nanoseconds]): milliseconds {
  const hrTime = process.hrtime(startTime);
  return hrTime && hrTime[0] * 1e3 + hrTime[1] / 1e6;
}

const histogram = new Histogram();
let latencyCheckLoop: NodeJS.Timeout;
function startEventLoopMonitoring() {
  let prevTime = process.hrtime();
  const interval = 100;
  latencyCheckLoop = setInterval(() => {
    const now = getMillisecs(prevTime);
    const lag = now - interval;
    prevTime = process.hrtime();
    histogram.update(lag);
  }, interval);
}

function stopEventLoopMonitoring() {
  clearInterval(latencyCheckLoop);
  console.log("Results");
  console.log(JSON.stringify(histogram.printObj(), null, 4));
}

async function benchmark() {
  const prevTime = process.hrtime();
  startEventLoopMonitoring();
  for (let i = 0; i < 40000; ++i) {
    await compileQuery(schema, document, "", {
      disableLeafSerialization: false,
      customSerializers: {
        String,
        ID: String,
        Boolean,
        Int: Number,
        Float: Number
      }
    });
  }
  setTimeout(() => {
    stopEventLoopMonitoring();
    console.log(`Total time: ${getMillisecs(prevTime)}ms`);
  }, 0);
}

benchmark().catch(console.error);

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
      isPublished: "true",
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
