import { DocumentNode, GraphQLSchema, parse, validate } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { compileQuery, isCompiledQuery } from "../execution";
import { fieldExpansionEnricher } from "../resolve-info";

describe("resolver info", () => {
  let inf: any;
  const schema = makeExecutableSchema({
    typeDefs: `
        type Query {
          foo: Foo
        }
        type Foo {
          a: String
          b: Int
          c: Boolean!
          d: Bar
        }
        type Bar {
          e: String!
          f: Boolean!
        }
      `,
    resolvers: {
      Query: {
        foo(_: any, _1: any, _2: any, info: any) {
          inf = info;
        }
      }
    }
  });

  afterEach(() => {
    inf = undefined;
  });

  describe("Field info enricher", () => {
    const normalResolveInfoFields = [
      "fieldName",
      "fieldNodes",
      "returnType",
      "parentType",
      "schema",
      "fragments",
      "operation",
      "rootValue",
      "variableValues",
      "path"
    ].sort();

    test("no enricher provided", () => {
      const prepared = compileQuery(schema, parse(`query { foo { a } }`), "");
      if (!isCompiledQuery(prepared)) {
        throw prepared;
      }
      prepared.query(undefined, undefined, {});
      expect(Object.keys(inf).sort()).toEqual(normalResolveInfoFields);
    });
    test("null enricher provided", () => {
      const prepared = compileQuery(schema, parse(`query { foo { a } }`), "", {
        resolverInfoEnricher: null as any
      });
      if (!isCompiledQuery(prepared)) {
        throw prepared;
      }
      prepared.query(undefined, undefined, {});
      expect(Object.keys(inf).sort()).toEqual(normalResolveInfoFields);
    });
    test("enricher with wrong type provided", () => {
      expect(() =>
        compileQuery(schema, parse(`query { foo { a } }`), "", {
          resolverInfoEnricher: {} as any
        })
      ).toThrow();
    });

    test("enricher can overrule resolve info properties", () => {
      const prepared = compileQuery(schema, parse(`query { foo { a } }`), "", {
        resolverInfoEnricher: () => ({ schema: "hello" })
      });
      if (!isCompiledQuery(prepared)) {
        throw prepared;
      }
      prepared.query(undefined, undefined, {});
      expect(Object.keys(inf).sort()).toEqual(normalResolveInfoFields);
      expect(inf.schema).toBe("hello");
    });

    test("enricher can add properties", () => {
      const prepared = compileQuery(schema, parse(`query { foo { a } }`), "", {
        resolverInfoEnricher: () => ({ fancyNewField: "hello" })
      });
      if (!isCompiledQuery(prepared)) {
        throw prepared;
      }
      prepared.query(undefined, undefined, {});
      expect(Object.keys(inf).sort()).toEqual(
        normalResolveInfoFields.concat("fancyNewField").sort()
      );
      expect(inf.fancyNewField).toBe("hello");
    });

    // The type system covers for a lot of these cases but
    // not everyone is using Typescript.
    describe("enricher return types", () => {
      function testReturn(
        value: any,
        fields: string[] = normalResolveInfoFields
      ) {
        const prepared = compileQuery(
          schema,
          parse(`query { foo { a } }`),
          "",
          { resolverInfoEnricher: () => value }
        );
        if (!isCompiledQuery(prepared)) {
          throw prepared;
        }
        prepared.query(undefined, undefined, {});
        expect(Object.keys(inf).sort()).toEqual(fields.sort());
      }

      test("enricher that returns object", () => {
        testReturn({ test: "" }, normalResolveInfoFields.concat("test"));
        testReturn(
          { test: "", test1: null },
          normalResolveInfoFields.concat("test", "test1")
        );
        testReturn(
          { test: {}, test1: null },
          normalResolveInfoFields.concat("test", "test1")
        );
      });
      test("enricher that returns falsy value", () => {
        testReturn(null);
        testReturn(undefined);
        testReturn(false);
        testReturn(0);
      });
      test("enricher that returns a string", () => {
        testReturn("");
        testReturn("string");
      });
      test("enricher that returns arrays", () => {
        testReturn([]);
        testReturn(["string"]);
        testReturn([null]);
        testReturn([1]);
        testReturn([{ test: "" }]);
      });
      test("enricher that returns a number", () => {
        testReturn(1.2);
        testReturn(1);
      });
      test("enricher that returns a number", () => {
        testReturn(1.2);
        testReturn(1);
      });
    });
  });

  describe("Field Expansion", () => {
    function executeQuery(
      schema: GraphQLSchema,
      document: DocumentNode,
      rootValue?: any,
      contextValue?: any,
      variableValues?: any,
      operationName?: string
    ) {
      const prepared: any = compileQuery(
        schema,
        document as any,
        operationName || "",
        { resolverInfoEnricher: fieldExpansionEnricher }
      );
      if (!isCompiledQuery(prepared)) {
        return prepared;
      }
      return prepared.query(rootValue, contextValue, variableValues || {});
    }

    describe("simple types", () => {
      test("all selection fields of the current resolver", async () => {
        const result = await executeQuery(
          schema,
          parse(`query { foo { a d { e } } }`)
        );
        expect(result.errors).not.toBeDefined();
        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Foo": Object {
                      "a": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "d": Object {
                        "Bar": Object {
                          "e": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                      },
                    },
                  }
              `);
      });

      test("with fragments", async () => {
        await executeQuery(
          schema,
          parse(
            `
          query {
            foo {
              ...fooFragment1
              a
              b
              ... on Foo {
                c
                ...fooFragment1
              }
            }
          }
          fragment fooFragment1 on Foo {
            a
            b
          }
          `
          )
        );

        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Foo": Object {
                      "a": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "b": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "c": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });

      test("inline fragments", async () => {
        await executeQuery(
          schema,
          parse(
            `
          query {
            foo {
              ... {
                ... {
                  d {
                    ... {
                      e
                    }
                  }
                }
              }
            }
          }
          `
          )
        );

        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Foo": Object {
                      "d": Object {
                        "Bar": Object {
                          "e": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                      },
                    },
                  }
              `);
      });

      test("aggregate multiple selections of the same field", async () => {
        await executeQuery(
          schema,
          parse(
            `
          query {
            foo {
              a
            }
            foo {
              b
            }
            foo {
              c
            }
          }
          `
          )
        );

        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Foo": Object {
                      "a": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "b": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "c": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });
    });

    describe("interfaces", () => {
      let inf: any;
      const schema = makeExecutableSchema({
        typeDefs: `
        type Query {
          iBar: IBar
        }
        interface IBar {
          id: ID!
          title: String
        }
        type Bar1 implements IBar {
          id: ID!
          title: String
          b1: Int!
        }
        type Bar2 implements IBar {
          id: ID!
          title: String
          b2: Boolean!
        }
      `,
        resolvers: {
          Query: {
            iBar(_: any, _1: any, _2: any, info: any) {
              inf = info;
            }
          },
          IBar: {
            __resolveType() {
              return "Bar1";
            }
          }
        }
      });

      afterEach(() => {
        inf = undefined;
      });

      test("compute interface field nodes", async () => {
        const result = await executeQuery(
          schema,
          parse(
            `
            query {
              iBar {
                id
                title
              }
            }
          `
          )
        );

        expect(result.errors).not.toBeDefined();

        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Bar1": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Bar2": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "IBar": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });

      test("fields per type", async () => {
        const result = await executeQuery(
          schema,
          parse(
            `
            query {
              iBar {
                id
                title
                ... on Bar1 {
                  b1
                }
                ... on Bar2 {
                  b2
                }
              }
            }
          `
          )
        );
        expect(result.errors).not.toBeDefined();
        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Bar1": Object {
                      "b1": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Bar2": Object {
                      "b2": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "IBar": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });

      test("fields per type - with fragments", async () => {
        const result = await executeQuery(
          schema,
          parse(
            `
            query {
              iBar {
                id
                title
                ... on Bar1 {
                  b1
                  ...bar1
                }
                ... on Bar2 {
                  b2
                }
                ...bar2
              }
            }
            fragment bar1 on Bar1 {
              id
              b1
            }
            fragment bar2 on Bar2 {
              title
              b2
            }
          `
          )
        );

        expect(result.errors).not.toBeDefined();
        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Bar1": Object {
                      "b1": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Bar2": Object {
                      "b2": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "IBar": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });

      test("aggregate multiple selections of the same field", async () => {
        const result = await executeQuery(
          schema,
          parse(
            `
            query {
              iBar {
                id
              }
              iBar {
                title
              }
              iBar {
                ... on Bar1 {
                  b1
                }
              }
              iBar {
                ... on Bar2 {
                  b2
                }
              }
            }
          `
          )
        );

        expect(result.errors).not.toBeDefined();

        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Bar1": Object {
                      "b1": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Bar2": Object {
                      "b2": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "IBar": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "title": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });
    });

    describe("unions", () => {
      let inf: any;
      const schema = makeExecutableSchema({
        typeDefs: `
        type Query {
          uBaz: Baz
        }
        union Baz = Foo | Bar
        type Foo {
          common: String
          foo: String
        }
        type Bar {
          common: String
          bar: Int
        }
      `,
        resolvers: {
          Query: {
            uBaz(_: any, _1: any, _2: any, info: any) {
              inf = info;
            }
          },
          Baz: {
            __resolveType() {
              return "Foo";
            }
          }
        }
      });

      afterEach(() => {
        inf = undefined;
      });

      test("union field nodes", async () => {
        const result = await executeQuery(
          schema,
          parse(
            `
            query {
              uBaz {
                ... on Foo {
                  foo
                }
                ... on Bar {
                  bar
                }
              }
            }
          `
          )
        );

        expect(result.errors).not.toBeDefined();
        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Bar": Object {
                      "bar": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Foo": Object {
                      "foo": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });

      test("union field nodes - repeating names", async () => {
        const result = await executeQuery(
          schema,
          parse(
            `
            query {
              uBaz {
                ... on Foo {
                  foo
                  common
                }
                ... on Bar {
                  bar
                }
              }
            }
          `
          )
        );

        expect(result.errors).not.toBeDefined();
        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Bar": Object {
                      "bar": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Foo": Object {
                      "common": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "foo": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });

      test("__typename", async () => {
        const result = await executeQuery(
          schema,
          parse(`
          query {
            uBaz {
              __typename
              alias: __typename
            }
          }
        `)
        );
        expect(result.errors).not.toBeDefined();
        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Bar": Object {},
                    "Foo": Object {},
                  }
              `);
      });

      test("unions with fragments", async () => {
        const result = await executeQuery(
          schema,
          parse(
            `
            query {
              uBaz {
                ...foo
                ...bar
              }
            }
            fragment foo on Foo {
              foo
            }
            fragment bar on Bar {
              bar
            }
          `
          )
        );

        expect(result.errors).not.toBeDefined();
        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Bar": Object {
                      "bar": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Foo": Object {
                      "foo": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });

      test("aggregate multiple selections of the same field", async () => {
        const result = await executeQuery(
          schema,
          parse(
            `
            query {
              uBaz {
                ...bar
              }
              ... {
                uBaz {
                  ...foo
                }
              }
            }
            fragment foo on Foo {
              foo
            }
            fragment bar on Bar {
              bar
            }
          `
          )
        );

        expect(result.errors).not.toBeDefined();
        expect(inf.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Bar": Object {
                      "bar": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Foo": Object {
                      "foo": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });
    });

    describe("lists, inputs, unions and interfaces 2", () => {
      let infNode: any;
      let infElements: any;
      let infMedia: any;
      const schema = makeExecutableSchema({
        typeDefs: `
        type Query {
          node(id: ID!): Node!
          elements(like: String!): [DocumentElement!]!
          media(tags: [String!]!): [Media!]!
        }
        interface Node {
          id: ID!
        }
        interface Media {
          url: String!
          tags: [Tag!]
        }
        type Tag implements Node {
          id: ID!
          name: String!
        }
        union DocumentElement = Image | Video | Div
        type Div {
          children: [DocumentElement!]
        }
        type Image implements Node & Media {
          id: ID!
          url: String!
          tags: [Tag!]
          width: Int
        }
        type Video implements Node & Media {
          id: ID!
          url: String!
          tags: [Tag!]
          source: VideoSource
        }
        enum VideoSource {
          YOUTUBE
          VIMEO
        }
      `,
        resolvers: {
          Query: {
            node(_: any, { id }: any, _2: any, info: any) {
              infNode = info;
              return {
                id,
                url: "https://example.com",
                children: [],
                width: 50
              };
            },
            elements(_: any, _1: any, _2: any, info: any) {
              infElements = info;
              return [];
            },
            media(_: any, _1: any, _2: any, info: any) {
              infMedia = info;
              return [];
            }
          },
          Node: {
            __resolveType() {
              return "Image";
            }
          },
          Media: {
            __resolveType() {
              return "Video";
            }
          },
          DocumentElement: {
            __resolveType() {
              return "Div";
            }
          }
        }
      });

      afterEach(() => {
        infNode = undefined;
        infElements = undefined;
        infMedia = undefined;
      });

      test("node", async () => {
        const doc = parse(`
        query {
          node(id: "root") {
            id
            ... on Image {
              width
            }
            ... on DocumentElement {
              __typename
              ... on Image {
                url
                tags {
                  name
                }
              }
              ... on Media {
                tags {
                  id
                }
              }
            }
          }
        }
      `);
        const result = await executeQuery(schema, doc);
        const validationErrors = validate(schema, doc);
        if (validationErrors.length > 0) {
          console.error(validationErrors);
        }
        expect(validationErrors.length).toBe(0);
        expect(result.errors).not.toBeDefined();
        expect(infNode.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Image": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "tags": Object {
                        "Tag": Object {
                          "id": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                          "name": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                      },
                      "url": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "width": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Media": Object {
                      "tags": Object {
                        "Tag": Object {
                          "id": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                      },
                    },
                    "Node": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Tag": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Video": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "tags": Object {
                        "Tag": Object {
                          "id": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                      },
                    },
                  }
              `);
      });

      test("elements", async () => {
        const doc = parse(`
        query {
          elements(like: "div") {
            __typename
            ... on Node {
              id
            }
            ... on Media {
              url
            }
            ... on Div {
              children {
                ... on Node {
                  id
                }
                ...mediaContainer
              }
            }
          }
        }
        fragment mediaContainer on Div {
          children {
            ... on Media {
              url
            }
          }
        }
      `);
        const result = await executeQuery(schema, doc);
        const validationErrors = validate(schema, doc);
        if (validationErrors.length > 0) {
          console.error(validationErrors);
        }
        expect(validationErrors.length).toBe(0);

        expect(result.errors).not.toBeDefined();
        expect(infElements.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Div": Object {
                      "children": Object {
                        "Div": Object {
                          "children": Object {
                            "Div": Object {},
                            "Image": Object {
                              "url": Object {
                                Symbol(LeafFieldSymbol): true,
                              },
                            },
                            "Media": Object {
                              "url": Object {
                                Symbol(LeafFieldSymbol): true,
                              },
                            },
                            "Node": Object {},
                            "Video": Object {
                              "url": Object {
                                Symbol(LeafFieldSymbol): true,
                              },
                            },
                          },
                        },
                        "Image": Object {
                          "id": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                        "Media": Object {},
                        "Node": Object {
                          "id": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                        "Video": Object {
                          "id": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                      },
                    },
                    "Image": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "url": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Media": Object {
                      "url": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Node": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Video": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "url": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });

      test("alias 1", async () => {
        const doc = parse(`
        query {
          node(id: "tag:1") {
            ... {
              otherId: id
            }
            ... on Tag {
              tagId: id,
              tagName: name
            }
          }
        }
      `);
        const result = await executeQuery(schema, doc);
        const validationErrors = validate(schema, doc);
        if (validationErrors.length > 0) {
          console.error(validationErrors);
        }
        expect(validationErrors.length).toBe(0);
        expect(result.errors).not.toBeDefined();
        expect(infNode.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Image": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Media": Object {},
                    "Node": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Tag": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "name": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Video": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                  }
              `);
      });

      test("aliases and __typename should not be included in resolveInfo", async () => {
        const doc = parse(`
        query {
          node(id: "tag:1") {
            __typename
            ... {
              __typename
              otherId: id
            }
            ... on Tag {
              tagId: id,
              tagName: name
            }
            ... on DocumentElement {
              __typename
            }
            ... on Media {
              __typename
              mediaTags: tags {
                __typename
                mediaTagName: name
              }
            }
          }
        }
      `);
        const result = await executeQuery(schema, doc);
        const validationErrors = validate(schema, doc);
        if (validationErrors.length > 0) {
          console.error(validationErrors);
        }
        expect(validationErrors.length).toBe(0);
        expect(result.errors).not.toBeDefined();
        expect(infNode.fieldExpansion).toMatchInlineSnapshot(`
                  Object {
                    "Image": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "tags": Object {
                        "Tag": Object {
                          "name": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                      },
                    },
                    "Media": Object {
                      "tags": Object {
                        "Tag": Object {
                          "name": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                      },
                    },
                    "Node": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Tag": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "name": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                    },
                    "Video": Object {
                      "id": Object {
                        Symbol(LeafFieldSymbol): true,
                      },
                      "tags": Object {
                        "Tag": Object {
                          "name": Object {
                            Symbol(LeafFieldSymbol): true,
                          },
                        },
                      },
                    },
                  }
              `);
      });
      // i guess i need to add few more tests for that with my own schema
      test("shouldInclude function is there and it works", async () => {
        const doc = parse(`
          query ($var: Boolean!) {
            node(id: "tag:1") {
                ... on Tag @skip(if: $var) {
                  id
                }
                ... on Image {
                  width
                }
              }
            }
        `);
        const rootValue = { root: "val" };

        await executeQuery(schema, doc, rootValue, null, {
          var: true
        });
        const validationErrors = validate(schema, doc);
        if (validationErrors.length > 0) {
          console.error(validationErrors);
        }

        expect(infNode.fieldExpansion.Tag.id.__shouldInclude).toBeDefined();
        expect(infNode.variableValues).toBeDefined();
        const idShouldInclude = infNode.fieldExpansion.Tag.id.__shouldInclude({
          variables: infNode.variableValues
        });
        expect(idShouldInclude).toBe(false);
      });
    });

    describe.only("lookahead resolution", () => {
      let infNode: any;
      let infElements: any;
      let infMedia: any;

      const expensiveFunction = jest.fn();

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query {
            node(id: ID!): Node!
          }

          interface Node {
            id: ID!
          }

          interface Media {
            url: String!
            tags: [Tag!]
          }

          type Image implements Node & Media {
            id: ID!
            url: String!
            tags: [Tag!]
            width: Int
          }

          type Video implements Node & Media {
            id: ID!
            url: String!
            tags: [Tag!]

          }

        type Tag implements Node {
          id: ID!
          name: String!
        }

          `,

        resolvers: {
          Query: {
            node: (root, args, context, info) => {
              infNode = info;

              const lookaheadForUrl = "url" in infNode.fieldExpansion.Image;

              const includeUrl =
                infNode.fieldExpansion.Image?.url?.__shouldInclude({
                  variables: info.variableValues
                });
              console.log("skipUrl", includeUrl);

              if (lookaheadForUrl && !includeUrl) {
                expensiveFunction();
                return {
                  id: "id",
                  url: "we looked and and found that url was requested"
                };
              } else if (lookaheadForUrl) {
                return {
                  id: "id",
                  url: "we looked and and found that url was requested, but we didn't do expensive function"
                };
              } else {
                return {
                  id: "id without lookahead",
                  url: "not lookahead"
                };
              }
            }
          },
          Node: {
            __resolveType() {
              return "Image";
            }
          },
          Image: {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            tags: (root, args, context, info) => {},
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            width: (root, args, context, info) => {}
          },
          Video: {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            url: (root, args, context, info) => {},
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            tags: (root, args, context, info) => {}
          },
          Tag: {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            name: (root, args, context, info) => {}
          }
        }
      });

      function executeQuery(
        schema: GraphQLSchema,
        document: DocumentNode,
        rootValue?: any,
        contextValue?: any,
        variableValues?: any,
        operationName?: string
      ) {
        const prepared: any = compileQuery(
          schema,
          document as any,
          operationName || "",
          { resolverInfoEnricher: fieldExpansionEnricher }
        );
        if (!isCompiledQuery(prepared)) {
          return prepared;
        }
        return prepared.query(rootValue, contextValue, variableValues || {});
      }

      afterEach(() => {
        infNode = undefined;
        infElements = undefined;
        infMedia = undefined;
      });

      test("basic test", async () => {
        let doc = parse(`
            query {
              node(id: "bla") {
                ... on Video {
              url
              }
          }
        }
          `);
        const rootValue = { root: "val" };

        let result = await executeQuery(schema, doc, rootValue, null, {});

        /*
        * why we don't have there
         {
         data: {
                  id: "id without lookahead",
                  url: "not lookahead"
                }
          }

        ???
        * */
        expect(result).toMatchInlineSnapshot(`
          Object {
            "data": Object {
              "node": Object {},
            },
          }
        `);

        doc = parse(`
            query {
              node(id: "bla") {
                ... on Image {
              url
              }
          }
        }
          `);

        result = await executeQuery(schema, doc, rootValue, null, {});

        expect(result).toMatchInlineSnapshot(`
          Object {
            "data": Object {
              "node": Object {
                "url": "we looked and and found that url was requested, but we didn't do expensive function",
              },
            },
          }
        `);
        console.log("starting query with the skip");
        doc = parse(`
            query($var: Boolean!) {
              node(id: "bla") {
                ... on Image @skip(if: $var) {
              url
              }
          }
        }
          `);

        result = await executeQuery(schema, doc, rootValue, null, {
          var: true
        });

        expect(result).toMatchInlineSnapshot(`
          Object {
            "data": Object {
              "node": Object {
                "url": undefined,
              },
            },
          }
        `);

        expect(expensiveFunction).toHaveBeenCalledTimes(1);
      });
    });
  });
});
