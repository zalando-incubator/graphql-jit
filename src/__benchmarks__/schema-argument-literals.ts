import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  parse
} from "graphql";

const itemsCount = 100;

const DateTime = new GraphQLScalarType({
  name: "DateTime",
  serialize: (value) => String((value as Date).getTime()),
  parseValue: (value) => new Date(value as string),
  parseLiteral: (node) => {
    if (node.kind !== Kind.STRING) {
      throw new Error("Expected a string");
    }
    return new Date(node.value);
  }
});

const Kind_ = new GraphQLEnumType({
  name: "Kind",
  values: { A: { value: "a" }, B: { value: "b" } }
});

const Window = new GraphQLInputObjectType({
  name: "Window",
  fields: {
    from: { type: DateTime },
    to: { type: DateTime },
    step: { type: new GraphQLNonNull(GraphQLInt), defaultValue: 1 },
    label: { type: GraphQLString }
  }
});

export function schema() {
  const Item = new GraphQLObjectType({
    name: "Item",
    fields: {
      plain: {
        type: GraphQLString,
        args: {
          n: { type: GraphQLInt },
          s: { type: GraphQLString },
          kind: { type: Kind_ }
        },
        resolve: (_item, { n, s, kind }) => `${n}${s}${kind}`
      },
      at: {
        type: GraphQLString,
        args: { when: { type: DateTime } },
        resolve: (_item, { when }) => String(when.getTime())
      },
      window: {
        type: GraphQLString,
        args: { input: { type: Window } },
        resolve: (_item, { input }) =>
          `${input.from.getTime()}:${input.to.getTime()}:${input.step}`
      }
    }
  });
  const items = Array.from({ length: itemsCount }, (_, id) => ({ id }));
  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: {
        items: {
          type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(Item))),
          resolve: () => items
        }
      }
    })
  });
}

const from = "2020-01-01T00:00:00Z";
const to = "2020-01-02T00:00:00Z";

/**
 * Each query calls an argument-taking field once per item, so the cost of
 * coercing arguments is multiplied by `itemsCount`.
 */
export const queries = {
  // Baseline: built-in scalars and enums are inlined at compile time.
  argumentBuiltInLiterals: {
    query: parse(`{ items { plain(n: 1, s: "a", kind: B) } }`)
  },
  // Custom scalar literal: parsed again on every execution (spec behavior).
  argumentCustomScalarLiteral: {
    query: parse(`{ items { at(when: "${from}") } }`)
  },
  argumentCustomScalarInInput: {
    query: parse(
      `{ items { window(input: { from: "${from}", to: "${to}" }) } }`
    )
  },
  // Variables are coerced once per request, not per field. The omitted `step`
  // takes its default.
  argumentVariableInput: {
    query: parse(`query ($v: Window) { items { window(input: $v) } }`),
    variables: { v: { from, to } }
  }
};
