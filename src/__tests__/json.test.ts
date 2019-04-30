import fastJson from "fast-json-stringify";
import {
  formatError,
  GraphQLBoolean,
  GraphQLError,
  GraphQLID,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse,
  GraphQLInt,
  GraphQLScalarType
} from "graphql";
import { buildExecutionContext } from "graphql/execution/execute";
import { compileQuery } from "../index";
import { queryToJSONSchema } from "../json";

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

  const context: any = buildExecutionContext(
    blogSchema,
    parse(query),
    null,
    null,
    null,
    null,
    null
  );
  const jsonSchema = queryToJSONSchema(context);
  test("json schema creation", () => {
    expect(jsonSchema).toMatchSnapshot();
  });

  describe("fast json stringify", () => {
    test("valid json schema", () => {
      expect(typeof fastJson(jsonSchema) === "function").toBeTruthy();
    });
    test("valid response serialization", async () => {
      const prepared: any = compileQuery(blogSchema, parse(query), "", {
        customJSONSerializer: true
      });
      const response = await prepared.query(undefined, undefined, {});
      expect(prepared.stringify).not.toBe(JSON.stringify);
      expect(prepared.stringify(response)).toEqual(JSON.stringify(response));
    });
    test("valid response serialization 2", async () => {
      const prepared: any = compileQuery(blogSchema, parse(query), "", {
        customJSONSerializer: false
      });
      expect(prepared.stringify).toBe(JSON.stringify);
    });
    test("error response serialization", async () => {
      const stringify = fastJson(jsonSchema);
      const response = {
        errors: [formatError(new GraphQLError("test"))]
      };
      expect(stringify(response)).toEqual(JSON.stringify(response));
    });
  });
});
