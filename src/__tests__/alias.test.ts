/* tslint:disable:no-big-function */
import {
  DocumentNode,
  GraphQLBoolean,
  GraphQLID,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLSchema,
  GraphQLString,
  NameNode,
  parse
} from "graphql";
import { compileQuery } from "../index";

function executeQuery(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: any,
  vars?: any
) {
  const prepared: any = compileQuery(schema, document, "");
  return prepared.query(rootValue, undefined, vars);
}

const BlogAuthor = new GraphQLObjectType({
  name: "Author",
  fields: () => ({
    id: { type: GraphQLString },
    name: { type: GraphQLString, resolve: ({ name }) => name }
  })
});

const BlogArticle: GraphQLObjectType = new GraphQLObjectType({
  name: "Article",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLID) },
    isPublished: { type: GraphQLBoolean },
    author: { type: BlogAuthor },
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

const BlogSchema = new GraphQLSchema({
  query: BlogQuery
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

describe("Execute: Handles execution with a complex schema completely aliased", () => {
  test("executes using a schema with alias", async () => {
    const request = `
      {
        myFeed: feed {
          myId: id,
          myTitle: title
        },
        myArticle: article(id: "1") {
          ...articleFields,
          myAuthor: author {
            myId: id,
            myName: name
          }
        }
      }

      fragment articleFields on Article {
        myId: id,
        myIsPublished: isPublished,
        myTitle:  title,
        myBody: body
      }
    `;

    const result = await executeQuery(BlogSchema, parse(request));
    expect(result).toEqual({
      data: {
        myFeed: [
          { myId: "1", myTitle: "My Article 1" },
          { myId: "2", myTitle: "My Article 2" },
          { myId: "3", myTitle: "My Article 3" },
          { myId: "4", myTitle: "My Article 4" },
          { myId: "5", myTitle: "My Article 5" },
          { myId: "6", myTitle: "My Article 6" },
          { myId: "7", myTitle: "My Article 7" },
          { myId: "8", myTitle: "My Article 8" },
          { myId: "9", myTitle: "My Article 9" },
          { myId: "10", myTitle: "My Article 10" }
        ],
        myArticle: {
          myId: "1",
          myIsPublished: true,
          myTitle: "My Article 1",
          myBody: "This is a post",
          myAuthor: {
            myId: "123",
            myName: "John Smith"
          }
        }
      }
    });
  });
});

describe("alias resolveinfo", () => {
  test("passes the correct info objects handling aliases. fixes#729", async () => {
    const ast = parse("query { a: test b: test c: test }");

    const infos: any[] = [];

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Test",
        fields: {
          test: {
            type: GraphQLString,
            resolve(_: any, _1: any, _2: any, inf: GraphQLResolveInfo) {
              infos.push(inf);
            }
          }
        }
      })
    });

    const rootValue = { root: "val" };

    await executeQuery(schema, ast, rootValue, { var: 123 });
    // we don't rely on the order of execution
    expect(
      infos.find(info => info.fieldNodes[0].alias.value === "a")
    ).toBeDefined();
    expect(
      infos.find(info => info.fieldNodes[0].alias.value === "b")
    ).toBeDefined();
    expect(
      infos.find(info => info.fieldNodes[0].alias.value === "c")
    ).toBeDefined();
  });

  test("passes the correct info objects handling aliases (nested). fixes#729", async () => {
    const ast = parse(`query {
      a: test {
        foo: leaf
      }
      b: test {
        foo: leaf
      }
      c: test {
        foo: leaf
      }
    }`);

    const fields: any = [];

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Root",
        fields: {
          test: {
            type: new GraphQLObjectType({
              name: "Test",
              fields: {
                leaf: {
                  type: GraphQLString,
                  resolve(
                    parent: any,
                    _1: any,
                    _2: any,
                    inf: GraphQLResolveInfo
                  ) {
                    fields.push({
                      parent: parent.name,
                      current: (inf.fieldNodes[0].alias as NameNode).value
                    });
                  }
                }
              }
            }),
            resolve(_: any, _1: any, _2: any, inf: GraphQLResolveInfo) {
              return {
                name: (inf.fieldNodes[0].alias as NameNode).value
              };
            }
          }
        }
      })
    });

    const rootValue = { root: "val" };

    await executeQuery(schema, ast, rootValue, { var: 123 });

    // we don't rely on the order of execution
    expect(
      fields.find(
        (field: any) => field.parent === "a" && field.current === "foo"
      )
    ).toBeDefined();
    expect(
      fields.find(
        (field: any) => field.parent === "b" && field.current === "foo"
      )
    ).toBeDefined();
    expect(
      fields.find(
        (field: any) => field.parent === "c" && field.current === "foo"
      )
    ).toBeDefined();
  });
});
