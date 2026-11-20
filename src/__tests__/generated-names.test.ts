import { buildSchema, execute, parse } from "graphql";
import { compileQuery, isCompiledQuery } from "../index";

// Resolvers and resolve infos are looked up by names generated from type,
// field and response names; different fields must never share one.

async function runBoth(schema: any, query: string) {
  const document = parse(query);
  const compiled = compileQuery(schema, document);
  if (!isCompiledQuery(compiled)) {
    throw new Error(JSON.stringify(compiled.errors));
  }
  return {
    jit: await compiled.query({}, {}, {}),
    js: await execute({ schema, document, rootValue: {} })
  };
}

describe("resolve info names", () => {
  let seen: string[] = [];
  const schema = buildSchema(`
    type Query { x: String, t: T }
    type T { x: String, t: T }
  `);
  for (const type of ["Query", "T"]) {
    const fields = (schema.getType(type) as any).getFields();
    fields.x.resolve = (_s: any, _a: any, _c: any, info: any) => {
      seen.push(`${type}.x: ${info.parentType.name}.${info.fieldName}`);
      return "x";
    };
    fields.t.resolve = () => ({});
  }

  beforeEach(() => {
    seen = [];
  });

  test.each([
    "{ x_t: x  t { x } }",
    "{ x_t_t: x  t { t { x } } }",
    "{ x_t: x  t { x }  t_x: t { x } }"
  ])("every resolver gets the info of its own field: %s", async (query) => {
    const { jit, js } = await runBoth(schema, query);
    expect(jit).toEqual(js);
    const jitSeen = seen.splice(0, seen.length / 2);
    expect(jitSeen.sort()).toEqual(seen.sort());
    for (const entry of jitSeen) {
      const [resolver, info] = entry.split(": ");
      expect(info).toBe(resolver);
    }
  });
});

describe("resolver names", () => {
  const schema = buildSchema(`
    type Query { x: A, y: Ab, z: A_ }
    type A { bc: String, _b: String }
    type Ab { c: String }
    type A_ { b: String }
  `);
  for (const type of ["A", "Ab", "A_"]) {
    const fields = (schema.getType(type) as any).getFields();
    for (const name of Object.keys(fields)) {
      fields[name].resolve = () => `${type}.${name}`;
    }
  }
  const queryFields = (schema.getType("Query") as any).getFields();
  for (const name of ["x", "y", "z"]) {
    queryFields[name].resolve = () => ({});
  }

  test("every field runs its own resolver", async () => {
    const { jit, js } = await runBoth(
      schema,
      "{ x { bc _b } y { c } z { b } }"
    );
    expect(jit).toEqual(js);
    expect(jit).toEqual({
      data: {
        x: { bc: "A.bc", _b: "A._b" },
        y: { c: "Ab.c" },
        z: { b: "A_.b" }
      }
    });
  });
});
