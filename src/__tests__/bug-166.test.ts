import { GraphQLSchema, parse } from "graphql";
import { compileQuery, isCompiledQuery } from "../index";
import { makeExecutableSchema } from "@graphql-tools/schema";

const data = {};

function executeTestQuery(
  query: string,
  variables = {},
  schema: GraphQLSchema
) {
  const ast = parse(query);
  const compiled: any = compileQuery(schema, ast, "", { debug: true } as any);
  if (!isCompiledQuery(compiled)) {
    return compiled;
  }
  return compiled.query(data, undefined, variables);
}

describe("actual example from user", () => {
  const testSchema = makeExecutableSchema({
    typeDefs: `type Query {
    detailContent: [Content!]
    }

    type Post implements Content {
        id: ID!
        title: String!
        type: String!
        related: [Content]
    }

    type Article implements Content {
        id: ID!
        title: String!
        type: String!
    }

    interface Content {
        id: ID!
        title: String!
        type: String!
    }`,
    resolvers: {
      Query: {
        detailContent: () => [
          {
            __typename: "Post",
            id: "post:1",
            title: "Introduction to GraphQL!",
            related: [
              {
                __typename: "Article",
                id: "article:1",
                title: "article Introduction to GraphQL!",
                type: "article"
              }
            ]
          },
          {
            __typename: "Post",
            id: "post:2",
            title: "GraphQL-Jit a fast engine for GraphQL",
            related: [
              {
                __typename: "Article",
                id: "article:2",
                title: "article GraphQL-Jit a fast engine for GraphQL",
                type: "article"
              }
            ]
          },
          {
            __typename: "Article",
            id: "article:1",
            title: "article Introduction to GraphQL!",
            type: "article"
          },
          {
            __typename: "Article",
            id: "article:2",
            title: "article GraphQL-Jit a fast engine for GraphQL",
            type: "article"
          }
        ]
      }
    }
  });

  test("spreads misbehaving", async () => {
    const query = `query TEST(
      $includeOnly: Boolean!
      ){
      detailContent{
        ...articleFragment
        ...on Post {
          ...postFragment
          related{
              id
          ...articleFragment1 @include(if:$includeOnly)
          }
        }
      }
      }

      fragment postFragment on Post {
      id
      title
      }

      fragment articleFragment on Article {
      title
      type
      }

      fragment articleFragment1 on Article {
        title
        type
        }`;
    const result = executeTestQuery(query, { includeOnly: false }, testSchema);

    expect(result.data).toEqual({
      detailContent: [
        {
          id: "post:1",
          title: "Introduction to GraphQL!",
          related: [
            {
              id: "article:1"
            }
          ]
        },
        {
          id: "post:2",
          title: "GraphQL-Jit a fast engine for GraphQL",
          related: [
            {
              id: "article:2"
            }
          ]
        },
        {
          title: "article Introduction to GraphQL!",
          type: "article"
        },
        {
          title: "article GraphQL-Jit a fast engine for GraphQL",
          type: "article"
        }
      ]
    });
  });

  test("inline behaving correctly", async () => {
    const query = `query TEST(
      $includeOnly: Boolean!
      ){
      detailContent{
        ...on Article {
          title
          type
        }
        ...on Post {
          ...postFragment
          related{
              id
          ...articleFragment @include(if:$includeOnly)
          }
        }
      }
      }

      fragment postFragment on Post {
      id
      title
      }

      fragment articleFragment on Article {
      title
      type
      }`;
    const result = executeTestQuery(query, { includeOnly: false }, testSchema);

    expect(result.data).toEqual({
      detailContent: [
        {
          id: "post:1",
          title: "Introduction to GraphQL!",
          related: [{ id: "article:1" }]
        },
        {
          id: "post:2",
          title: "GraphQL-Jit a fast engine for GraphQL",
          related: [{ id: "article:2" }]
        },
        {
          title: "article Introduction to GraphQL!",
          type: "article"
        },
        {
          title: "article GraphQL-Jit a fast engine for GraphQL",
          type: "article"
        }
      ]
    });
  });
});

describe("reproduce minimally", () => {
  const schema = makeExecutableSchema({
    typeDefs: `type Query {
      someQuery: [X!]
    }

    interface X {
      id: ID!
      title: String!
    }

    type A implements X {
      id: ID!
      title: String!
      related: [X]
    }

    type B implements X {
      id: ID!
      title: String!
    }
    `,
    resolvers: {
      Query: {
        someQuery: () => [
          {
            __typename: "A",
            id: "a:1",
            title: "a - one",
            related: [
              {
                __typename: "B",
                id: "b:1",
                title: "b - one"
              }
            ]
          },
          {
            __typename: "B",
            id: "b:1",
            title: "b - one"
          }
        ]
      }
    }
  });

  // test passes
  test("testing success with include directive", async () => {
    const query = `query TEST($includeOnly: Boolean!) {
      someQuery {
        ...bFrag
        ...on A {
          id
          related {
            id
            ...bFrag1 @include(if: $includeOnly)
          }
        }
      }
    }

    fragment bFrag on B {
      title
    }

    fragment bFrag1 on B {
      title
    }`;
    const result = executeTestQuery(query, { includeOnly: false }, schema);

    expect(result.data).toEqual({
      someQuery: [
        {
          id: "a:1",
          related: [
            {
              id: "b:1"
            }
          ]
        },
        {
          title: "b - one"
        }
      ]
    });
  });

  // test fails
  test("testing the actual issue with include directive", async () => {
    const query = `query TEST($includeOnly: Boolean!) {
      someQuery {
        ...bFrag
        ...on A {
          id
          related {
            id
            ...bFrag @include(if: $includeOnly)
          }
        }
      }
    }

    fragment bFrag on B {
      title
    }`;
    const result = executeTestQuery(query, { includeOnly: false }, schema);

    expect(result.data).toEqual({
      someQuery: [
        {
          id: "a:1",
          related: [
            {
              id: "b:1"
            }
          ]
        },
        {
          title: "b - one"
        }
      ]
    });
  });

  // test passes
  test("testing success with skip directive", async () => {
    const query = `query TEST($skipOnly: Boolean!) {
      someQuery {
        ...bFrag
        ...on A {
          id
          related {
            id
            ...bFrag1 @skip(if: $skipOnly)
          }
        }
      }
    }

    fragment bFrag on B {
      title
    }

    fragment bFrag1 on B {
      title
    }`;
    const result = executeTestQuery(query, { skipOnly: true }, schema);

    expect(result.data).toEqual({
      someQuery: [
        {
          id: "a:1",
          related: [
            {
              id: "b:1"
            }
          ]
        },
        {
          title: "b - one"
        }
      ]
    });
  });

  // test fails
  test("testing the actual issue with skip directive", async () => {
    const query = `query TEST($skipOnly: Boolean!) {
      someQuery {
        ...bFrag
        ...on A {
          id
          related {
            id
            ...bFrag @skip(if: $skipOnly)
          }
        }
      }
    }

    fragment bFrag on B {
      title
    }`;
    const result = executeTestQuery(query, { skipOnly: true }, schema);
    expect(result.errors).toBeUndefined();

    expect(result.data).toEqual({
      someQuery: [
        {
          id: "a:1",
          related: [
            {
              id: "b:1"
            }
          ]
        },
        {
          title: "b - one"
        }
      ]
    });
  });
});
