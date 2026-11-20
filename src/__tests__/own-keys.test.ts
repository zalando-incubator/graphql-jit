import {
  execute,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { compileQuery, isCompiledQuery } from "../index";

// Keys that are Object.prototype members are ordinary keys of variables and
// input values, like in GraphQL.js.

function describeObject(o: any) {
  const proto = Object.getPrototypeOf(o);
  return {
    keys: Object.keys(o),
    ownProto: Object.prototype.hasOwnProperty.call(o, "__proto__"),
    proto:
      proto === Object.prototype
        ? "Object.prototype"
        : proto === null
        ? "null"
        : "other",
    json: JSON.stringify(o)
  };
}

async function runBoth(
  schema: GraphQLSchema,
  query: string,
  variables: Record<string, unknown> = {}
) {
  const document = parse(query);
  const compiled = compileQuery(schema, document);
  if (!isCompiledQuery(compiled)) {
    throw new Error(JSON.stringify(compiled.errors));
  }
  return {
    jit: await compiled.query(undefined, undefined, variables),
    js: await execute({ schema, document, variableValues: variables })
  };
}

describe("variables named after Object.prototype members", () => {
  const In = new GraphQLInputObjectType({
    name: "In",
    fields: { x: { type: GraphQLInt } }
  });
  let seen: any[] = [];
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: {
        f: {
          type: GraphQLString,
          args: { i: { type: In }, s: { type: GraphQLString } },
          resolve: (_source, args, _context, info) => {
            seen.push({
              args: JSON.stringify(args),
              variables: describeObject(info.variableValues)
            });
            return "ok";
          }
        }
      }
    })
  });

  beforeEach(() => {
    seen = [];
  });

  test("a provided $__proto__ variable is an own key", async () => {
    const { jit, js } = await runBoth(
      schema,
      "query ($__proto__: In) { f(i: $__proto__) }",
      JSON.parse('{"__proto__": {"x": 1}}')
    );
    expect(jit).toEqual(js);
    const [jitSeen, jsSeen] = seen;
    // GraphQL.js 16 assigns this variable with the prototype setter, so only
    // GraphQL.js 17 can serve as the reference here.
    expect(jsSeen).toBeDefined();
    expect(jitSeen.args).toBe('{"i":{"x":1}}');
    expect(jitSeen.variables.ownProto).toBe(true);
    expect(jitSeen.variables.proto).toBe("Object.prototype");
  });

  test("an omitted $__proto__ variable is absent", async () => {
    const { jit, js } = await runBoth(
      schema,
      "query ($__proto__: In) { f(i: $__proto__) }"
    );
    expect(jit).toEqual(js);
    const [jitSeen, jsSeen] = seen;
    expect(jitSeen.args).toBe("{}");
    expect(jitSeen.args).toBe(jsSeen.args);
    expect(jitSeen.variables.ownProto).toBe(false);
    expect(jitSeen.variables.proto).toBe("Object.prototype");
  });

  test("an omitted $__proto__ variable uses its default", async () => {
    const { jit, js } = await runBoth(
      schema,
      "query ($__proto__: In = { x: 2 }) { f(i: $__proto__) }"
    );
    expect(jit).toEqual(js);
    const [jitSeen, jsSeen] = seen;
    // GraphQL.js 16 assigns this variable with the prototype setter, so only
    // GraphQL.js 17 can serve as the reference here.
    expect(jsSeen).toBeDefined();
    expect(jitSeen.args).toBe('{"i":{"x":2}}');
    expect(jitSeen.variables.ownProto).toBe(true);
  });

  test.each(["constructor", "toString", "valueOf", "hasOwnProperty"])(
    "an omitted $%s variable is absent",
    async (name) => {
      const { jit, js } = await runBoth(
        schema,
        `query ($${name}: String) { f(s: $${name}) }`
      );
      expect(jit).toEqual(js);
      expect(jit).toEqual({ data: { f: "ok" } });
      expect(seen[0].args).toBe("{}");
      expect(seen[0].args).toBe(seen[1].args);
    }
  );

  test("a provided $constructor variable is used", async () => {
    const { jit, js } = await runBoth(
      schema,
      "query ($constructor: String) { f(s: $constructor) }",
      { constructor: "c" }
    );
    expect(jit).toEqual(js);
    expect(seen[0].args).toBe('{"s":"c"}');
  });
});

describe("default values with a __proto__ key", () => {
  let seen: any[] = [];
  const I = new GraphQLInputObjectType({
    name: "I",
    fields: { a: { type: GraphQLInt } }
  });

  function schemaWithDefault(defaultValue: unknown) {
    const Outer = new GraphQLInputObjectType({
      name: "Outer",
      fields: { inner: { type: I, defaultValue } }
    });
    return new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          f: {
            type: GraphQLString,
            args: { o: { type: I, defaultValue }, v: { type: Outer } },
            resolve: (_source, args) => {
              seen.push(describeObject(args.v ? args.v.inner : args.o));
              return "ok";
            }
          }
        }
      })
    });
  }

  beforeEach(() => {
    seen = [];
  });

  test.each([
    ["an object", '{"a": 1, "__proto__": {"x": 1}}'],
    ["a primitive", '{"a": 1, "__proto__": 5}']
  ])("keeps a __proto__ key with %s value as an own key", async (_, json) => {
    for (const [query, variables] of [
      ["{ f }", {}],
      ["query ($v: Outer) { f(v: $v) }", { v: {} }]
    ] as const) {
      seen = [];
      const { jit, js } = await runBoth(
        schemaWithDefault(JSON.parse(json)),
        query,
        variables
      );
      expect(jit).toEqual(js);
      const [jitSeen, jsSeen] = seen;
      expect(jitSeen).toEqual(jsSeen);
      expect(jitSeen.ownProto).toBe(true);
      expect(jitSeen.proto).toBe("Object.prototype");
    }
  });
});
