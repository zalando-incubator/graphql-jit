import fastJson, {
  ObjectSchema,
  ArraySchema,
  StringSchema,
  NumberSchema,
  BooleanSchema,
  IntegerSchema,
  NullSchema
} from "fast-json-stringify";
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
  getOperationRootType,
  FieldNode,
  GraphQLType,
  isObjectType,
  isListType,
  isNonNullType,
  isEnumType,
  isScalarType,
  isAbstractType
} from "graphql";
import { ExecutionContext, collectFields } from "graphql/execution/execute";
import { compileQuery } from "../index";
import { resolveFieldDef, collectSubfields } from "../ast";

const PRIMITIVES: {
  [key: string]: (
    | StringSchema
    | NumberSchema
    | BooleanSchema
    | IntegerSchema)["type"];
} = {
  Int: "integer",
  Float: "number",
  String: "string",
  Boolean: "boolean",
  ID: "string"
};

function queryToJSONSchema(exeContext: ExecutionContext): ObjectSchema {
  const type = getOperationRootType(exeContext.schema, exeContext.operation);
  const fields = collectFields(
    exeContext,
    type,
    exeContext.operation.selectionSet,
    Object.create(null),
    Object.create(null)
  );
  const fieldProperties = Object.create(null);
  for (const responseName of Object.keys(fields)) {
    const fieldType = resolveFieldDef(exeContext, type, fields[responseName]);
    if (!fieldType) {
      // if field does not exist, it should be ignored for compatibility concerns.
      // Usually, validation would stop it before getting here but this could be an old query
      continue;
    }
    fieldProperties[responseName] = transformNode(
      exeContext,
      fields[responseName],
      fieldType.type
    );
  }
  return {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: fieldProperties,
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

function transformNode(
  exeContext: ExecutionContext,
  fieldNodes: FieldNode[],
  type: GraphQLType
):
  | ObjectSchema
  | ArraySchema
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | IntegerSchema
  | NullSchema {
  if (isObjectType(type)) {
    const subfields = collectSubfields(exeContext, type, fieldNodes);
    const properties = Object.create(null);
    for (const responseName of Object.keys(subfields)) {
      const fieldType = resolveFieldDef(
        exeContext,
        type,
        subfields[responseName]
      );
      if (!fieldType) {
        // if field does not exist, it should be ignored for compatibility concerns.
        // Usually, validation would stop it before getting here but this could be an old query
        continue;
      }
      properties[responseName] = transformNode(
        exeContext,
        subfields[responseName],
        fieldType.type
      );
    }
    return {
      type: "object",
      nullable: true,
      properties
    };
  }
  if (isListType(type)) {
    return {
      type: "array",
      nullable: true,
      items: transformNode(exeContext, fieldNodes, type.ofType)
    };
  }
  if (isNonNullType(type)) {
    const nullable = transformNode(exeContext, fieldNodes, type.ofType);
    if ("nullable" in nullable) {
      delete nullable.nullable;
    }
    return nullable;
  }
  if (isEnumType(type)) {
    return {
      type: "string",
      nullable: true
    };
  }
  if (isScalarType(type)) {
    const jsonSchemaType = PRIMITIVES[type.name];
    if (jsonSchemaType) {
      return {
        type: jsonSchemaType,
        nullable: true
      } as StringSchema | NumberSchema | BooleanSchema | IntegerSchema;
    }
  }
  if (isAbstractType(type)) {
    return exeContext.schema.getPossibleTypes(type).reduce(
      (res, t) => {
        const jsonSchema = transformNode(
          exeContext,
          fieldNodes,
          t
        ) as ObjectSchema;
        res.properties = { ...res.properties, ...jsonSchema.properties };
        return res;
      },
      {
        type: "object",
        nullable: true,
        properties: {}
      }
    );
  }
  throw new Error(`Got unhandled type: ${type.name}`);
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
      const prepared: any = compileQuery(blogSchema, parse(query), "", {
        customJSONSerializer: false
      });
      expect(prepared.stringify).toBe(JSON.stringify);
    });
    test("throws if customJSONSerializer is true", async () => {
      expect(() => {
        const prepared: any = compileQuery(blogSchema, parse(query), "", {
          customJSONSerializer: true
        });
      }).toThrow(
        "customJSONSerializer must either be false or a function that returns a custom JSON serializer"
      );
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
