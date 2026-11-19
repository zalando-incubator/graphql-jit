import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  parse,
  visit
} from "graphql";
import { compileQuery } from "../index";

// The parser only produces valid names, but a DocumentNode can be
// constructed by hand.
describe("invalid names in a hand-built document", () => {
  const invalidName = "invalid-name";

  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: {
        a: {
          type: GraphQLString,
          args: { x: { type: GraphQLString } },
          resolve: (_: any, args: any) => args.x
        }
      }
    })
  });

  it("rejects an invalid alias", () => {
    const document: any = parse("{ b: a }");
    document.definitions[0].selectionSet.selections[0].alias.value =
      invalidName;
    const prepared: any = compileQuery(schema, document);
    expect(prepared.errors[0].message).toMatch(/^Invalid field alias/);
  });

  it("rejects an invalid field name", () => {
    const document: any = parse("{ a }");
    document.definitions[0].selectionSet.selections[0].name.value = invalidName;
    const prepared: any = compileQuery(schema, document);
    expect(prepared.errors[0].message).toMatch(/^Invalid field name/);
  });

  it("rejects an invalid field name in an aliased field", () => {
    const document: any = parse("{ b: a }");
    document.definitions[0].selectionSet.selections[0].name.value = invalidName;
    const prepared: any = compileQuery(schema, document);
    expect(prepared.errors[0].message).toMatch(/^Invalid field name/);
  });

  it("rejects an invalid field name in a merged field", () => {
    const document: any = parse("{ b: a b: a }");
    document.definitions[0].selectionSet.selections[1].name.value = invalidName;
    const prepared: any = compileQuery(schema, document);
    expect(prepared.errors[0].message).toMatch(/^Invalid field name/);
  });

  it("names every merged field in a non-null error", () => {
    const nonNullSchema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          a: { type: new GraphQLNonNull(GraphQLString), resolve: () => null }
        }
      })
    });
    const prepared: any = compileQuery(nonNullSchema, parse("{ b: a b: a }"));
    expect(prepared.query({}, {}, {}).errors[0].message).toBe(
      "Cannot return null for non-nullable field Query.(a,a)."
    );
  });

  it("rejects an invalid variable name", () => {
    const document = visit(parse("query($v: String) { a(x: $v) }"), {
      Variable: (node) => ({
        ...node,
        name: { ...node.name, value: invalidName }
      })
    });
    const prepared: any = compileQuery(schema, document);
    expect(prepared.errors[0].message).toMatch(/^Invalid variable name/);
  });

  it("rejects an invalid name in an undefined variable reference", () => {
    const document: any = parse("{ a(x: $v) }");
    document.definitions[0].selectionSet.selections[0].arguments[0].value.name.value =
      invalidName;
    const prepared: any = compileQuery(schema, document);
    expect(prepared.errors[0].message).toMatch(/^Invalid variable name/);
  });
});

// GraphQL.js validates type names when a type is constructed (v16+), but
// the name can still be changed afterwards, and v15 does not validate it.
describe("invalid type names in a programmatic schema", () => {
  function schemaWithInput(type: any) {
    return new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          a: {
            type: GraphQLString,
            args: { x: { type } },
            resolve: () => "a"
          }
        }
      })
    });
  }

  it.each([
    [
      "input object",
      new GraphQLInputObjectType({
        name: "In",
        fields: { f: { type: GraphQLString } }
      })
    ],
    ["enum", new GraphQLEnumType({ name: "In", values: { A: {} } })],
    [
      "custom scalar",
      new GraphQLScalarType({ name: "In", parseValue: (v) => v })
    ]
  ])("rejects an invalid %s type name in variables", (_, type: any) => {
    const schema = schemaWithInput(new GraphQLList(new GraphQLNonNull(type)));
    type.name = "invalid-name";
    const prepared: any = compileQuery(
      schema,
      parse("query($v: [In!]) { a(x: $v) }")
    );
    expect(prepared.errors[0].message).toMatch(/^Invalid type name/);
  });
});
