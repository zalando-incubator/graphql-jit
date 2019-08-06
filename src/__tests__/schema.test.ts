/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/schema-test.js
 */

/* tslint:disable:no-big-function */
import {
  DocumentNode,
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
import { compileQuery, isCompiledQuery } from "../index";

function executeQuery(schema: GraphQLSchema, document: DocumentNode) {
  const prepared = compileQuery(schema, document, "");
  if (!isCompiledQuery(prepared)) {
    return prepared;
  }
  return prepared.query(undefined, undefined, undefined);
}

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

const BlogSchema = new GraphQLSchema({
  query: BlogQuery
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

describe("Execute: Handles execution with a complex schema", () => {
  test("executes using a schema", async () => {
    const request = `
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
    `;

    // Note: this is intentionally not validating to ensure appropriate
    // behavior occurs when executing an invalid query.
    const result = await executeQuery(BlogSchema, parse(request));
    expect(result).toEqual({
      data: {
        feed: [
          { id: "1", title: "My Article 1" },
          { id: "2", title: "My Article 2" },
          { id: "3", title: "My Article 3" },
          { id: "4", title: "My Article 4" },
          { id: "5", title: "My Article 5" },
          { id: "6", title: "My Article 6" },
          { id: "7", title: "My Article 7" },
          { id: "8", title: "My Article 8" },
          { id: "9", title: "My Article 9" },
          { id: "10", title: "My Article 10" }
        ],
        article: {
          id: "1",
          isPublished: true,
          title: "My Article 1",
          body: "This is a post",
          author: {
            id: "123",
            name: "John Smith",
            pic: {
              url: "cdn://123",
              width: 640,
              height: 480
            },
            recentArticle: {
              id: "1",
              isPublished: true,
              title: "My Article 1",
              body: "This is a post",
              keywords: ["foo", "bar", "1", "true", null]
            }
          }
        }
      }
    });
  });
  test("executes with resolves nested in lists", async () => {
    const request = `
      {
        feed {
          id,
          title,
          author {
            pic(width: 640, height: 480) {
              url,
              width,
              height
            }
          }
        }
      }
    `;

    // Note: this is intentionally not validating to ensure appropriate
    // behavior occurs when executing an invalid query.
    const result = await executeQuery(BlogSchema, parse(request));
    expect(result).toEqual({
      data: {
        feed: [
          {
            id: "1",
            title: "My Article 1",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          },
          {
            id: "2",
            title: "My Article 2",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          },
          {
            id: "3",
            title: "My Article 3",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          },
          {
            id: "4",
            title: "My Article 4",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          },
          {
            id: "5",
            title: "My Article 5",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          },
          {
            id: "6",
            title: "My Article 6",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          },
          {
            id: "7",
            title: "My Article 7",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          },
          {
            id: "8",
            title: "My Article 8",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          },
          {
            id: "9",
            title: "My Article 9",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          },
          {
            id: "10",
            title: "My Article 10",
            author: {
              pic: {
                url: "cdn://123",
                width: 640,
                height: 480
              }
            }
          }
        ]
      }
    });
  });
  test("executes using a schema without lists", async () => {
    const request = `
      {
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
            }
          }
        }
      }

      fragment articleFields on Article {
        id,
        isPublished,
        title,
        body
      }
    `;

    // Note: this is intentionally not validating to ensure appropriate
    // behavior occurs when executing an invalid query.
    const result = await executeQuery(BlogSchema, parse(request));
    expect(result).toEqual({
      data: {
        article: {
          id: "1",
          isPublished: true,
          title: "My Article 1",
          body: "This is a post",
          author: {
            id: "123",
            name: "John Smith",
            pic: {
              url: "cdn://123",
              width: 640,
              height: 480
            },
            recentArticle: {
              id: "1",
              isPublished: true,
              title: "My Article 1",
              body: "This is a post"
            }
          }
        }
      }
    });
  });

  test("executes IntrospectionQuery", () => {
    const queryAST = parse(getIntrospectionQuery({ descriptions: true }));
    const result = executeQuery(BlogSchema, queryAST);
    expect(result).toMatchSnapshot();
  });
});
