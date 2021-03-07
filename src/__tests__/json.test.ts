import fastJson, {
  BooleanSchema,
  IntegerSchema,
  NumberSchema,
  ObjectSchema,
  StringSchema
} from "fast-json-stringify";
import {
  formatError,
  GraphQLBoolean,
  GraphQLError,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { ExecutionContext } from "graphql/execution/execute";
import { compileQuery } from "../index";

const PRIMITIVES: {
  [key: string]: (
    | StringSchema
    | NumberSchema
    | BooleanSchema
    | IntegerSchema
  )["type"];
} = {
  Int: "integer",
  Float: "number",
  String: "string",
  Boolean: "boolean",
  ID: "string"
};

function queryToJSONSchema(exeContext: ExecutionContext): ObjectSchema {
  expect(exeContext).toBeTruthy();
  return {
    type: "object",
    properties: {
      data: {
        type: "object",
        additionalProperties: true,
        nullable: true
      },
      errors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            message: {
              type: "string"
            },
            path: {
              type: "array",
              items: {
                type: ["string", "number"]
              }
            },
            locations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  line: {
                    type: "number"
                  },
                  column: {
                    type: "number"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

describe("json schema creator", () => {
  const BlogAuthor = new GraphQLObjectType({
    name: "Author",
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLID) },
      name: { type: GraphQLString },
      pic: {
        type: new GraphQLObjectType({
          name: "Pic",
          fields: {
            width: { type: GraphQLInt },
            height: { type: GraphQLInt },
            url: { type: GraphQLString }
          }
        })
      },
      recentArticle: {
        type: BlogArticle
      }
    })
  });

  const BlogArticle: GraphQLObjectType = new GraphQLObjectType({
    name: "Article",
    fields: {
      id: { type: new GraphQLNonNull(GraphQLID) },
      isPublished: { type: GraphQLBoolean },
      author: { type: new GraphQLNonNull(BlogAuthor) },
      title: { type: GraphQLString },
      body: { type: GraphQLString }
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
        resolve: () => [
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
        ]
      }
    }
  });

  function article(id: number): any {
    return {
      id,
      isPublished: true,
      author: {
        id: 123,
        name: "John Smith"
      },
      title: "My Article " + id,
      body: "This is a post",
      hidden: "This data is not exposed in the schema"
    };
  }

  const blogSchema = new GraphQLSchema({
    query: BlogQuery
  });

  const query = `
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

  describe("custom json serializer", () => {
    test("valid response serialization", async () => {
      const prepared: any = compileQuery(blogSchema, parse(query), "", {
        customJSONSerializer: compiledContext => {
          return fastJson(queryToJSONSchema(compiledContext));
        }
      });
      const response = await prepared.query(undefined, undefined, {});
      expect(prepared.stringify).not.toBe(JSON.stringify);
      expect(prepared.stringify(response)).toEqual(JSON.stringify(response));
    });
    test("valid response serialization 2", async () => {
      const prepared: any = compileQuery(blogSchema, parse(query), "");
      expect(prepared.stringify).toBe(JSON.stringify);
    });
    test("error response serialization", async () => {
      const prepared: any = compileQuery(blogSchema, parse(query), "", {
        customJSONSerializer: compiledContext => {
          return fastJson(queryToJSONSchema(compiledContext));
        }
      });
      const response = {
        errors: [formatError(new GraphQLError("test"))]
      };
      expect(prepared.stringify(response)).toEqual(JSON.stringify(response));
    });
  });
});
