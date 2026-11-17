import {
  GraphQLObjectType,
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
