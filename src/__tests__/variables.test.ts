/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/variables-test.js
 */

/* eslint-disable max-lines-per-function */
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { GraphQLArgumentConfig } from "graphql/type/definition";
import { compileQuery, isCompiledQuery } from "../index";
import createInspect from "../inspect";

const inspect = createInspect(10, 4);

const TestComplexScalar = new GraphQLScalarType({
  name: "ComplexScalar",
  serialize(value: any) {
    if (value === "DeserializedValue") {
      return "SerializedValue";
    }
    return null;
  },
  // eslint-disable-next-line
  parseValue(value: any) {
    if (value === "SerializedValue") {
      return "DeserializedValue";
    }
    return null;
  },
  parseLiteral(ast: any) {
    if (ast.value === "SerializedValue") {
      return "DeserializedValue";
    }
    return null;
  }
});

const TestComplexThrowingScalar = new GraphQLScalarType({
  name: "ComplexThrowingScalar",
  serialize() {
    throw new Error("complex-scalar-error");
  },
  parseValue() {
    throw new Error("complex-scalar-error");
  },
  parseLiteral() {
    return null;
  }
});

const TestInputObject = new GraphQLInputObjectType({
  name: "TestInputObject",
  fields: {
    a: { type: GraphQLString },
    b: { type: new GraphQLList(GraphQLString) },
    c: { type: new GraphQLNonNull(GraphQLString) },
    d: { type: TestComplexScalar },
    e: { type: new GraphQLList(GraphQLString) }
  }
});

const TestInputObjectWithDefaultValue = new GraphQLInputObjectType({
  name: "TestInputObjectWithDefaultValue",
  fields: {
    a: { type: GraphQLString },
    b: { type: GraphQLString, defaultValue: "default" }
  }
});

const TestThrowingInputObject = new GraphQLInputObjectType({
  name: "TestThrowingInputObject",
  fields: {
    a: { type: TestComplexThrowingScalar }
  }
});

const TestNestedInputObject = new GraphQLInputObjectType({
  name: "TestNestedInputObject",
  fields: {
    na: { type: new GraphQLNonNull(TestInputObject) },
    nb: { type: new GraphQLNonNull(GraphQLString), defaultValue: "NB" },
    nc: { type: new GraphQLList(new GraphQLNonNull(TestInputObject)) }
  }
});

const TestEnum = new GraphQLEnumType({
  name: "TestEnum",
  values: {
    NULL: { value: null },
    UNDEFINED: { value: undefined },
    NAN: { value: NaN },
    FALSE: { value: false },
    CUSTOM: { value: "custom value" },
    DEFAULT_VALUE: {}
  }
});

function fieldWithInputArg(inputArg: GraphQLArgumentConfig) {
  return {
    type: GraphQLString,
    args: { input: inputArg },
    resolve(_: any, args: any) {
      // eslint-disable-next-line no-prototype-builtins
      if (args.hasOwnProperty("input")) {
        return inspect(args.input);
      }
      return undefined;
    }
  };
}

const TestType = new GraphQLObjectType({
  name: "TestType",
  fields: {
    fieldWithEnumInput: fieldWithInputArg({ type: TestEnum }),
    fieldWithNonNullableEnumInput: fieldWithInputArg({
      type: new GraphQLNonNull(TestEnum)
    }),
    fieldWithDefaultInputValue: fieldWithInputArg({
      type: TestInputObjectWithDefaultValue
    }),
    fieldWithObjectInput: fieldWithInputArg({ type: TestInputObject }),
    fieldWithObjectThrowingInput: fieldWithInputArg({
      type: TestThrowingInputObject
    }),
    fieldWithNullableStringInput: fieldWithInputArg({ type: GraphQLString }),
    fieldWithNullableIDInput: fieldWithInputArg({ type: GraphQLID }),
    fieldWithNullableIntInput: fieldWithInputArg({ type: GraphQLInt }),
    fieldWithNullableFloatInput: fieldWithInputArg({ type: GraphQLFloat }),
    fieldWithNullableBooleanInput: fieldWithInputArg({ type: GraphQLBoolean }),
    fieldWithNonNullableStringInput: fieldWithInputArg({
      type: new GraphQLNonNull(GraphQLString)
    }),
    fieldWithNonNullableIDInput: fieldWithInputArg({
      type: new GraphQLNonNull(GraphQLID)
    }),
    fieldWithNonNullableIntInput: fieldWithInputArg({
      type: new GraphQLNonNull(GraphQLInt)
    }),
    fieldWithNonNullableFloatInput: fieldWithInputArg({
      type: new GraphQLNonNull(GraphQLFloat)
    }),
    fieldWithNonNullableBooleanInput: fieldWithInputArg({
      type: new GraphQLNonNull(GraphQLBoolean)
    }),
    fieldWithDefaultArgumentValue: fieldWithInputArg({
      type: GraphQLString,
      defaultValue: "Hello World"
    }),
    fieldWithNonNullableStringInputAndDefaultArgumentValue: fieldWithInputArg({
      type: new GraphQLNonNull(GraphQLString),
      defaultValue: "Hello World"
    }),
    fieldWithNestedInputObject: fieldWithInputArg({
      type: TestNestedInputObject
    }),
    list: fieldWithInputArg({ type: new GraphQLList(GraphQLString) }),
    superNestedList: fieldWithInputArg({
      type: new GraphQLList(new GraphQLList(new GraphQLList(GraphQLString)))
    }),
    nnList: fieldWithInputArg({
      type: new GraphQLNonNull(new GraphQLList(GraphQLString))
    }),
    listNN: fieldWithInputArg({
      type: new GraphQLList(new GraphQLNonNull(GraphQLString))
    }),
    nnListNN: fieldWithInputArg({
      type: new GraphQLNonNull(
        new GraphQLList(new GraphQLNonNull(GraphQLString))
      )
    })
  }
});

const schema = new GraphQLSchema({ query: TestType });

function executeQuery(query: string, variableValues?: any, s = schema) {
  const document = parse(query);
  const prepared = compileQuery(s, document, "");
  if (!isCompiledQuery(prepared)) {
    return prepared;
  }
  return prepared.query(undefined, undefined, variableValues);
}

describe("Execute: Handles inputs", () => {
  describe("Handles objects and nullability", () => {
    describe("using inline structs", () => {
      test("executes with complex input", async () => {
        const result = await executeQuery(`
          {
            fieldWithObjectInput(input: {a: "foo", b: ["bar"], c: "baz"})
          }
        `);

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ a: "foo", b: ["bar"], c: "baz" }'
          }
        });
      });

      test("properly parses single value to list", async () => {
        const result = await executeQuery(`
          {
            fieldWithObjectInput(input: {a: "foo", b: "bar", c: "baz"})
          }
        `);

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ a: "foo", b: ["bar"], c: "baz" }'
          }
        });
      });

      test("properly parses null value to null", async () => {
        const result = await executeQuery(`
          {
            fieldWithObjectInput(input: {a: null, b: null, c: "C", d: null})
          }
        `);

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ a: null, b: null, c: "C", d: null }'
          }
        });
      });

      test("properly parses null value in list", async () => {
        const result = await executeQuery(`
          {
            fieldWithObjectInput(input: {b: ["A",null,"C"], c: "C"})
          }
        `);

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ b: ["A", null, "C"], c: "C" }'
          }
        });
      });

      test("does not use incorrect value", async () => {
        const result = await executeQuery(`
          {
            fieldWithObjectInput(input: ["foo", "bar", "baz"])
          }
        `);

        expect(result).toMatchObject({
          errors: [
            {
              message:
                'Argument "input" of type "TestInputObject" has invalid value ["foo", "bar", "baz"].',
              locations: [{ line: 3, column: 41 }]
            }
          ]
        });
      });

      test("does not use incorrect nested value", async () => {
        const result = await executeQuery(`
          {
            fieldWithObjectInput(input: {b: ["A",null,"C"], c: false})
          }
        `);

        expect(result).toMatchObject({
          errors: [
            {
              message:
                'Argument "input" of type "TestInputObject" has invalid value {b: ["A", null, "C"], c: false}.',
              locations: [{ line: 3, column: 41 }]
            }
          ]
        });
      });

      test("properly parses nested objects", async () => {
        const result = await executeQuery(`
          {
            fieldWithNestedInputObject(input: {na: {b: ["A",null,"C"], c: "C"}, nc: [{b: ["NC"]}]})
          }
        `);

        expect(result).toEqual({
          data: {
            fieldWithNestedInputObject:
              '{ na: { b: ["A", null, "C"], c: "C" }, nb: "NB", nc: [{ b: ["NC"] }] }'
          }
        });
      });

      test("properly runs parseLiteral on complex scalar types", async () => {
        const result = await executeQuery(`
          {
            fieldWithObjectInput(input: {c: "foo", d: "SerializedValue"})
          }
        `);

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ c: "foo", d: "DeserializedValue" }'
          }
        });
      });
    });

    describe("using variables", () => {
      const doc = `
        query ($input: TestInputObject) {
          fieldWithObjectInput(input: $input)
        }
      `;

      test("executes with complex input", async () => {
        const params = { input: { a: "foo", b: ["bar"], c: "baz" } };
        const result = await executeQuery(doc, params);

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ a: "foo", b: ["bar"], c: "baz" }'
          }
        });
      });

      test("uses undefined when variable not provided", async () => {
        const result = await executeQuery(
          `
          query q($input: String) {
            fieldWithNullableStringInput(input: $input)
          }`,
          {
            // Intentionally missing variable values.
          }
        );

        expect(result).toEqual({
          data: {
            fieldWithNullableStringInput: null
          }
        });
      });

      test("uses null when variable provided explicit null value", async () => {
        const result = await executeQuery(
          `
          query q($input: String) {
            fieldWithNullableStringInput(input: $input)
          }`,
          { input: null }
        );

        expect(result).toEqual({
          data: {
            fieldWithNullableStringInput: "null"
          }
        });
      });

      test("uses default value when not provided", async () => {
        const result = await executeQuery(`
          query ($input: TestInputObject = {a: "foo", b: ["bar"], c: "baz"}) {
            fieldWithObjectInput(input: $input)
          }
        `);

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ a: "foo", b: ["bar"], c: "baz" }'
          }
        });
      });

      test("executes with complex inlined variables", async () => {
        const result = await executeQuery(
          `
          query q($a: String, $b: String, $c: String!) {
            fieldWithObjectInput(input: {a: $a, b: [$b], c: $c})
          }
        `,
          { a: "foo", b: "bar", c: "baz" }
        );

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ a: "foo", b: ["bar"], c: "baz" }'
          }
        });
      });

      test("properly parses nested variables", async () => {
        const result = await executeQuery(
          `
          query q($a: String, $b: String, $c: String!) {
            fieldWithNestedInputObject(input: {
            na: {b: ["A",null, $a], c: "C"},
            nb: "NB",
            nc: [{b: [], c: $c}, {b: ["NC", $b]}]})
          }
        `,
          {
            a: "A",
            b: "B",
            c: "C"
          }
        );

        expect(result).toEqual({
          data: {
            fieldWithNestedInputObject:
              '{ na: { b: ["A", null, "A"], c: "C" }, ' +
              'nb: "NB", nc: [{ b: [], c: "C" }, { b: ["NC", "B"] }] }'
          }
        });
      });
      test("properly parses nested variables to list", async () => {
        const result = await executeQuery(
          `
          query q($b: String) {
            fieldWithNestedInputObject(input: {
            na: {b: []},
            nb: "NB",
            nc: {b: ["NC", $b]}
            })
          }
        `,
          {
            b: "B"
          }
        );

        expect(result).toEqual({
          data: {
            fieldWithNestedInputObject:
              '{ na: { b: [] }, nb: "NB", nc: [{ b: ["NC", "B"] }] }'
          }
        });
      });

      test("does not use default value when provided", async () => {
        const result = await executeQuery(
          `query q($input: String = "Default value") {
            fieldWithNullableStringInput(input: $input)
          }`,
          { input: "Variable value" }
        );

        expect(result).toEqual({
          data: {
            fieldWithNullableStringInput: '"Variable value"'
          }
        });
      });

      test("uses explicit null value instead of default value", async () => {
        const result = await executeQuery(
          `
          query q($input: String = "Default value") {
            fieldWithNullableStringInput(input: $input)
          }`,
          { input: null }
        );

        expect(result).toEqual({
          data: {
            fieldWithNullableStringInput: "null"
          }
        });
      });

      test("uses null default value when not provided", async () => {
        const result = await executeQuery(
          `
          query q($input: String = null) {
            fieldWithNullableStringInput(input: $input)
          }`,
          {
            // Intentionally missing variable values.
          }
        );

        expect(result).toEqual({
          data: {
            fieldWithNullableStringInput: "null"
          }
        });
      });

      test("properly parses single value to list", async () => {
        const params = { input: { a: "foo", b: "bar", c: "baz" } };
        const result = await executeQuery(doc, params);

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ a: "foo", b: ["bar"], c: "baz" }'
          }
        });
      });

      test("executes with complex scalar input", async () => {
        const params = { input: { c: "foo", d: "SerializedValue" } };
        const result = await executeQuery(doc, params);

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: '{ c: "foo", d: "DeserializedValue" }'
          }
        });
      });

      test("preserves originalError when custom scalar throws", async () => {
        const params = { input: { a: "SerializedValue" } };
        const result = await executeQuery(
          `
        query ($input: TestThrowingInputObject) {
          fieldWithObjectThrowingInput(input: $input)
        }
      `,
          params
        );

        expect(result).toMatchObject({
          errors: [
            {
              message:
                'Variable "$a" got invalid value "SerializedValue"; Expected type ComplexThrowingScalar.',
              locations: [{ line: 2, column: 16 }]
            }
          ]
        });
        expect(result.errors![0].originalError?.message).toBe(
          "complex-scalar-error"
        );
      });

      test("errors on null for nested non-null", async () => {
        const params = { input: { a: "foo", b: "bar", c: null } };
        const result = await executeQuery(doc, params);

        expect(result).toMatchObject({
          errors: [
            {
              message:
                'Variable "$input" got invalid value { a: "foo", b: "bar", c: null }; ' +
                "Expected non-nullable type String! not to be null at value.c.",
              locations: [{ line: 2, column: 16 }]
            }
          ]
        });
      });

      test("errors on incorrect type", async () => {
        const result = await executeQuery(doc, { input: "foo bar" });

        expect(result).toMatchObject({
          errors: [
            {
              message:
                'Variable "$input" got invalid value "foo bar"; ' +
                "Expected type TestInputObject to be an object.",
              locations: [{ line: 2, column: 16 }]
            }
          ]
        });
      });

      test("errors on omission of nested non-null", async () => {
        const result = await executeQuery(doc, {
          input: { a: "foo", b: "bar" }
        });

        expect(result).toMatchObject({
          errors: [
            {
              message:
                'Variable "$input" got invalid value { a: "foo", b: "bar" }; ' +
                "Field value.c of required type String! was not provided.",
              locations: [{ line: 2, column: 16 }]
            }
          ]
        });
      });

      test("errors on addition of unknown input field", async () => {
        const params = {
          input: { a: "foo", b: "bar", c: "baz", extra: "dog" }
        };
        const result = await executeQuery(doc, params);

        expect(result).toMatchObject({
          errors: [
            {
              message:
                'Variable "$input" got invalid value { a: "foo", b: "bar", c: "baz", extra: "dog" }; ' +
                'Field "extra" is not defined by type TestInputObject.',
              locations: [{ line: 2, column: 16 }]
            }
          ]
        });
      });
    });
  });

  describe("Handles custom enum values", () => {
    test("allows custom enum values as inputs", async () => {
      const result = executeQuery(`
        {
          null: fieldWithEnumInput(input: NULL)
          NaN: fieldWithEnumInput(input: NAN)
          false: fieldWithEnumInput(input: FALSE)
          customValue: fieldWithEnumInput(input: CUSTOM)
          defaultValue: fieldWithEnumInput(input: DEFAULT_VALUE)
        }
      `);

      expect(result).toEqual({
        data: {
          null: "null",
          NaN: "NaN",
          false: "false",
          customValue: '"custom value"',
          defaultValue: '"DEFAULT_VALUE"'
        }
      });
    });

    test("field error when random enum value as enum input", async () => {
      const result = executeQuery(`
        {
          fieldWithEnumInput(input: WRONG)
        }
      `);

      expect(result).toMatchObject({
        errors: [
          {
            locations: [
              {
                column: 37,
                line: 3
              }
            ],
            message:
              'Argument "input" of type "TestEnum" has invalid value WRONG.'
          }
        ]
      });
    });

    test("field error when random string as enum input", async () => {
      const result = executeQuery(`
        {
          fieldWithEnumInput(input: "random")
        }
      `);

      expect(result).toMatchObject({
        errors: [
          {
            locations: [
              {
                column: 37,
                line: 3
              }
            ],
            message:
              'Argument "input" of type "TestEnum" has invalid value "random".'
          }
        ]
      });
    });

    test("allows non-nullable inputs to have null as enum custom value", async () => {
      const result = await executeQuery(`
        {
          fieldWithNonNullableEnumInput(input: NULL)
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNonNullableEnumInput: "null"
        }
      });
    });

    describe("using variables", () => {
      const doc = `
        query ($input: TestEnum) {
          fieldWithEnumInput(input: $input)
        }
      `;

      test("uses undefined when variable not provided", async () => {
        const result = await executeQuery(doc, {});

        expect(result).toEqual({
          data: {
            fieldWithEnumInput: null
          }
        });
      });

      test("uses null when variable provided explicit null value", async () => {
        const result = await executeQuery(doc, { input: null });

        expect(result).toEqual({
          data: {
            fieldWithEnumInput: "null"
          }
        });
      });

      test("uses default value when not provided", async () => {
        const result = await executeQuery(
          `
        query ($input: TestEnum = FALSE) {
          fieldWithEnumInput(input: $input)
        }
      `,
          {}
        );

        expect(result).toEqual({
          data: {
            fieldWithEnumInput: "false"
          }
        });
      });

      test("does not use default value when provided", async () => {
        const result = await executeQuery(
          `query ($input: TestEnum = FALSE) {
          fieldWithEnumInput(input: $input)
        }`,
          { input: "NAN" }
        );

        expect(result).toEqual({
          data: {
            fieldWithEnumInput: "NaN"
          }
        });
      });

      test("uses explicit null value instead of default value", async () => {
        const result = await executeQuery(
          `
          query q($input: TestEnum = FALSE) {
            fieldWithEnumInput(input: $input)
          }`,
          { input: null }
        );

        expect(result).toEqual({
          data: {
            fieldWithEnumInput: "null"
          }
        });
      });

      test("uses null default value when not provided", async () => {
        const result = await executeQuery(
          `
          query q($input: TestEnum = NULL) {
            fieldWithEnumInput(input: $input)
          }`,
          {
            // Intentionally missing variable values.
          }
        );

        expect(result).toEqual({
          data: {
            fieldWithEnumInput: "null"
          }
        });
      });

      test("errors on incorrect type", async () => {
        const result = await executeQuery(doc, { input: "foo bar" });

        expect(result).toMatchObject({
          errors: [
            {
              message:
                'Variable "$input" got invalid value "foo bar"; Expected type TestEnum.',
              locations: [{ line: 2, column: 16 }]
            }
          ]
        });
      });
    });
  });

  describe("Handles nullable scalars", () => {
    const doc = `
        query ($string: String, $id: ID, $int: Int, $float: Float, $boolean: Boolean) {
          fieldWithNullableStringInput(input: $string)
          fieldWithNullableIDInput(input: $id)
          fieldWithNullableIntInput(input: $int)
          fieldWithNullableFloatInput(input: $float)
          fieldWithNullableBooleanInput(input: $boolean)
        }
      `;
    test("allows nullable inputs to be omitted", async () => {
      const result = await executeQuery(`
        {
          fieldWithNullableStringInput
          fieldWithNullableIDInput
          fieldWithNullableIntInput
          fieldWithNullableFloatInput
          fieldWithNullableBooleanInput
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: null,
          fieldWithNullableIDInput: null,
          fieldWithNullableIntInput: null,
          fieldWithNullableFloatInput: null,
          fieldWithNullableBooleanInput: null
        }
      });
    });

    test("allows nullable inputs to be omitted in a variable", async () => {
      const result = await executeQuery(doc);

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: null,
          fieldWithNullableIDInput: null,
          fieldWithNullableIntInput: null,
          fieldWithNullableFloatInput: null,
          fieldWithNullableBooleanInput: null
        }
      });
    });

    test("allows nullable inputs to be omitted in an unlisted variable", async () => {
      const result = await executeQuery(`
        query {
          fieldWithNullableStringInput(input: $value)
          fieldWithNullableIDInput(input: $id)
          fieldWithNullableIntInput(input: $int)
          fieldWithNullableFloatInput(input: $float)
          fieldWithNullableBooleanInput(input: $boolean)
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: null,
          fieldWithNullableIDInput: null,
          fieldWithNullableIntInput: null,
          fieldWithNullableFloatInput: null,
          fieldWithNullableBooleanInput: null
        }
      });
    });

    test("allows nullable inputs to be set to null in a variable", async () => {
      const result = await executeQuery(doc, {
        string: null,
        id: null,
        int: null,
        float: null,
        boolean: null
      });

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: "null",
          fieldWithNullableIDInput: "null",
          fieldWithNullableIntInput: "null",
          fieldWithNullableFloatInput: "null",
          fieldWithNullableBooleanInput: "null"
        }
      });
    });

    test("allows nullable inputs to be set to a value in a variable", async () => {
      const result = await executeQuery(doc, {
        string: "a",
        id: "id",
        int: 1,
        float: 1.5,
        boolean: true
      });

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: '"a"',
          fieldWithNullableIDInput: '"id"',
          fieldWithNullableIntInput: "1",
          fieldWithNullableFloatInput: "1.5",
          fieldWithNullableBooleanInput: "true"
        }
      });
    });

    test("does not reuse previous inputs", async () => {
      const spy = jest.fn().mockReturnValue("test");
      const schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: "TestType",
          fields: {
            inputRecorder: {
              type: GraphQLString,
              args: { input: { type: GraphQLString } },
              resolve: spy
            }
          }
        })
      });

      const document = `
        query ($string: String) {
          inputRecorder(input: $string)
        }
      `;
      const compiled: any = compileQuery(schema, parse(document), "");
      compiled.query(undefined, undefined, { string: "id" });
      expect(spy).toHaveBeenCalledWith(
        undefined,
        { input: "id" },
        undefined,
        expect.any(Object)
      );
      compiled.query(undefined, undefined, {});
      expect(spy).toHaveBeenCalledWith(
        undefined,
        {},
        undefined,
        expect.any(Object)
      );
    });

    test("allows nullable inputs to be set to a value directly", async () => {
      const result = await executeQuery(`
        {
          fieldWithNullableStringInput(input: "a")
          fieldWithNullableIDInput(input: "id")
          fieldWithNullableIntInput(input: 1)
          fieldWithNullableFloatInput(input: 1.5)
          fieldWithNullableBooleanInput(input: true)
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: '"a"',
          fieldWithNullableIDInput: '"id"',
          fieldWithNullableIntInput: "1",
          fieldWithNullableFloatInput: "1.5",
          fieldWithNullableBooleanInput: "true"
        }
      });
    });

    test("does not allow 64bit integers to be set", async () => {
      const result = await executeQuery(
        `
         query ($int: Int) {
          fieldWithNullableIntInput(input: $int)
        }
      `,
        { int: Number.MAX_SAFE_INTEGER + 1 }
      );

      expect(result).toMatchObject({
        errors: [
          {
            locations: [
              {
                column: 17,
                line: 2
              }
            ],
            message:
              'Variable "$int" got invalid value 9007199254740992; Expected type Int; ' +
              "Int cannot represent non 32-bit signed integer value: 9007199254740992"
          }
        ]
      });
    });

    test("does not bad inputs to be set to a value in a variable", async () => {
      const result = await executeQuery(doc, {
        string: ["a"],
        id: ["id"],
        int: 1.5,
        float: NaN,
        boolean: "hello"
      });

      expect(result).toMatchObject({
        errors: [
          {
            locations: [
              {
                column: 16,
                line: 2
              }
            ],
            message:
              'Variable "$string" got invalid value ["a"]; Expected type String; ' +
              'String cannot represent a non string value: ["a"]'
          },
          {
            locations: [
              {
                column: 33,
                line: 2
              }
            ],
            message:
              'Variable "$id" got invalid value ["id"]; Expected type ID; ' +
              'ID cannot represent value: ["id"]'
          },
          {
            locations: [
              {
                column: 42,
                line: 2
              }
            ],
            message:
              'Variable "$int" got invalid value 1.5; Expected type Int; ' +
              "Int cannot represent non-integer value: 1.5"
          },
          {
            locations: [
              {
                column: 53,
                line: 2
              }
            ],
            message:
              'Variable "$float" got invalid value NaN; Expected type Float; ' +
              "Float cannot represent non numeric value: NaN"
          },
          {
            locations: [
              {
                column: 68,
                line: 2
              }
            ],
            message:
              'Variable "$boolean" got invalid value "hello"; Expected type Boolean; ' +
              'Boolean cannot represent a non boolean value: "hello"'
          }
        ]
      });
    });
  });

  describe("Handles non-nullable scalars", () => {
    const doc = `
        query ($string: String!, $id: ID!, $int: Int!, $float: Float!, $boolean: Boolean!) {
          fieldWithNonNullableStringInput(input: $string)
          fieldWithNonNullableIDInput(input: $id)
          fieldWithNonNullableIntInput(input: $int)
          fieldWithNonNullableFloatInput(input: $float)
          fieldWithNonNullableBooleanInput(input: $boolean)
        }
      `;
    test("allows non-nullable inputs to be omitted given a default", async () => {
      const result = await executeQuery(`
        query ($value: String = "default") {
          fieldWithNonNullableStringInput(input: $value)
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNonNullableStringInput: '"default"'
        }
      });
    });

    test("does not allow non-nullable inputs to be omitted in a variable", async () => {
      const result = await executeQuery(doc);

      expect(result).toMatchObject({
        errors: [
          {
            locations: [{ line: 2, column: 16 }],
            message:
              'Variable "$string" of required type "String!" was not provided.'
          },
          {
            locations: [
              {
                column: 34,
                line: 2
              }
            ],
            message: 'Variable "$id" of required type "ID!" was not provided.'
          },
          {
            locations: [
              {
                column: 44,
                line: 2
              }
            ],
            message: 'Variable "$int" of required type "Int!" was not provided.'
          },
          {
            locations: [
              {
                column: 56,
                line: 2
              }
            ],
            message:
              'Variable "$float" of required type "Float!" was not provided.'
          },
          {
            locations: [
              {
                column: 72,
                line: 2
              }
            ],
            message:
              'Variable "$boolean" of required type "Boolean!" was not provided.'
          }
        ]
      });
    });

    test("does not allow non-nullable inputs to be set to null in a variable", async () => {
      const result = await executeQuery(doc, {
        string: null,
        id: null,
        int: null,
        float: null,
        boolean: null
      });

      expect(result).toMatchObject({
        errors: [
          {
            locations: [
              {
                column: 16,
                line: 2
              }
            ],
            message:
              'Variable "$string" of non-null type "String!" must not be null.'
          },
          {
            locations: [
              {
                column: 34,
                line: 2
              }
            ],
            message: 'Variable "$id" of non-null type "ID!" must not be null.'
          },
          {
            locations: [
              {
                column: 44,
                line: 2
              }
            ],
            message: 'Variable "$int" of non-null type "Int!" must not be null.'
          },
          {
            locations: [
              {
                column: 56,
                line: 2
              }
            ],
            message:
              'Variable "$float" of non-null type "Float!" must not be null.'
          },
          {
            locations: [
              {
                column: 72,
                line: 2
              }
            ],
            message:
              'Variable "$boolean" of non-null type "Boolean!" must not be null.'
          }
        ]
      });
    });

    test("allows non-nullable inputs to be set to a value in a variable", async () => {
      const result = await executeQuery(doc, {
        string: "a",
        id: 1234,
        int: 1,
        float: 1.5,
        boolean: true
      });

      expect(result).toEqual({
        data: {
          fieldWithNonNullableStringInput: '"a"',
          fieldWithNonNullableIDInput: '"1234"',
          fieldWithNonNullableIntInput: "1",
          fieldWithNonNullableFloatInput: "1.5",
          fieldWithNonNullableBooleanInput: "true"
        }
      });
    });

    test("allows non-nullable inputs to be set to a value directly", async () => {
      const result = await executeQuery(`
        {
          fieldWithNonNullableStringInput(input: "a")
          fieldWithNonNullableIDInput(input: "id")
          fieldWithNonNullableIntInput(input: 1)
          fieldWithNonNullableFloatInput(input: 1.5)
          fieldWithNonNullableBooleanInput(input: true)
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNonNullableStringInput: '"a"',
          fieldWithNonNullableIDInput: '"id"',
          fieldWithNonNullableIntInput: "1",
          fieldWithNonNullableFloatInput: "1.5",
          fieldWithNonNullableBooleanInput: "true"
        }
      });
    });

    test("reports error for missing non-nullable inputs", async () => {
      const result = await executeQuery("{ fieldWithNonNullableStringInput }");

      expect(result).toMatchObject({
        errors: [
          {
            message:
              'Argument "input" of required type "String!" was not provided.',
            locations: [{ line: 1, column: 3 }]
          }
        ]
      });
    });

    test("reports error for array passed into string input", async () => {
      const doc = `
        query ($value: String!) {
          fieldWithNonNullableStringInput(input: $value)
        }
      `;
      const result = await executeQuery(doc, { value: [1, 2, 3] });

      expect(result).toMatchObject({
        errors: [
          {
            message:
              'Variable "$value" got invalid value [1, 2, 3]; ' +
              "Expected type String; String cannot represent a non string value: [1, 2, 3]",
            locations: [{ line: 2, column: 16 }]
          }
        ]
      });
    });

    it("reports error for non-provided variables for non-nullable inputs", async () => {
      // Note: this test would typically fail validation before encountering
      // this execution error, however for queries which previously validated
      // and are being run against a new schema which have introduced a breaking
      // change to make a formerly non-required argument required, this asserts
      // failure before allowing the underlying code to receive a non-null value.

      const result = await executeQuery(`
        {
          fieldWithNonNullableStringInput(input: $foo)
        }
      `);

      expect(result).toMatchObject({
        data: {
          fieldWithNonNullableStringInput: null
        },
        errors: [
          {
            message:
              'Argument "input" of required type "String!" was provided the ' +
              'variable "$foo" which was not provided a runtime value.',
            locations: [{ line: 3, column: 50 }],
            path: ["fieldWithNonNullableStringInput"]
          }
        ]
      });
    });
  });

  describe("Handles lists and nullability", () => {
    test("allows lists to be null", async () => {
      const doc = `
        query ($input: [String]) {
          list(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: null });

      expect(result).toEqual({ data: { list: "null" } });
    });

    test("allows deep nested lists", async () => {
      const doc = `
        query ($input: [[[String]]]) {
          superNestedList(input: $input)
        }
      `;
      const result = await executeQuery(doc, {
        input: [[["A"]], [["B"], ["C"]]]
      });

      expect(result).toEqual({
        data: { superNestedList: '[[["A"]], [["B"], ["C"]]]' }
      });
    });

    test("allows lists to contain values", async () => {
      const doc = `
        query ($input: [String]) {
          list(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: ["A"] });

      expect(result).toEqual({ data: { list: '["A"]' } });
    });

    test("allows lists to contain null", async () => {
      const doc = `
        query ($input: [String]) {
          list(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: ["A", null, "B"] });

      expect(result).toEqual({ data: { list: '["A", null, "B"]' } });
    });

    test("does not allow lists to contain unrelated items", async () => {
      const doc = `
        {
          list(input: [false])
        }
      `;
      const result = await executeQuery(doc);

      expect(result).toMatchObject({
        errors: [
          {
            locations: [
              {
                column: 23,
                line: 3
              }
            ],
            message:
              'Argument "input" of type "[String]" has invalid value [false].'
          }
        ]
      });
    });
    test("does not allow lists to be converted from unrelated items", async () => {
      const doc = `
        {
          list(input: false)
        }
      `;
      const result = await executeQuery(doc);

      expect(result).toMatchObject({
        errors: [
          {
            locations: [
              {
                column: 23,
                line: 3
              }
            ],
            message:
              'Argument "input" of type "[String]" has invalid value false.'
          }
        ]
      });
    });

    test("does not allow non-null lists to be null", async () => {
      const doc = `
        query ($input: [String]!) {
          nnList(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: null });

      expect(result).toMatchObject({
        errors: [
          {
            message:
              'Variable "$input" of non-null type "[String]!" must not be null.',
            locations: [{ line: 2, column: 16 }]
          }
        ]
      });
    });

    test("allows non-null lists to contain values", async () => {
      const doc = `
        query ($input: [String]!) {
          nnList(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: ["A"] });

      expect(result).toEqual({ data: { nnList: '["A"]' } });
    });

    test("allows non-null lists to contain null", async () => {
      const doc = `
        query ($input: [String]!) {
          nnList(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: ["A", null, "B"] });

      expect(result).toEqual({ data: { nnList: '["A", null, "B"]' } });
    });

    test("allows lists of non-nulls to be null", async () => {
      const doc = `
        query ($input: [String!]) {
          listNN(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: null });

      expect(result).toEqual({ data: { listNN: "null" } });
    });

    test("allows lists of non-nulls to contain values", async () => {
      const doc = `
        query ($input: [String!]) {
          listNN(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: ["A"] });

      expect(result).toEqual({ data: { listNN: '["A"]' } });
    });

    test("does not allow lists of non-nulls to contain null", async () => {
      const doc = `
        query ($input: [String!]) {
          listNN(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: ["A", null, "B"] });

      expect(result).toMatchObject({
        errors: [
          {
            message:
              'Variable "$input" got invalid value ["A", null, "B"]; ' +
              "Expected non-nullable type String! not to be null at value[1].",
            locations: [{ line: 2, column: 16 }]
          }
        ]
      });
    });

    test("does not allow non-null lists of non-nulls to be null", async () => {
      const doc = `
        query ($input: [String!]!) {
          nnListNN(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: null });

      expect(result).toMatchObject({
        errors: [
          {
            message:
              'Variable "$input" of non-null type "[String!]!" must not be null.',
            locations: [{ line: 2, column: 16 }]
          }
        ]
      });
    });

    test("allows non-null lists of non-nulls to contain values", async () => {
      const doc = `
        query ($input: [String!]!) {
          nnListNN(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: ["A"] });

      expect(result).toEqual({ data: { nnListNN: '["A"]' } });
    });

    test("does not allow non-null lists of non-nulls to contain null", async () => {
      const doc = `
        query ($input: [String!]!) {
          nnListNN(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: ["A", null, "B"] });

      expect(result).toMatchObject({
        errors: [
          {
            message:
              'Variable "$input" got invalid value ["A", null, "B"]; ' +
              "Expected non-nullable type String! not to be null at value[1].",
            locations: [{ line: 2, column: 16 }]
          }
        ]
      });
    });

    test("does not allow invalid types to be used as values", async () => {
      const doc = `
        query ($input: TestType!) {
          fieldWithObjectInput(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: { list: ["A", "B"] } });

      expect(result).toMatchObject({
        errors: [
          {
            message:
              'Variable "$input" expected value of type "TestType!" which ' +
              "cannot be used as an input type.",
            locations: [{ line: 2, column: 24 }]
          }
        ]
      });
    });

    test("does not allow unknown types to be used as values", async () => {
      const doc = `
        query ($input: UnknownType!) {
          fieldWithObjectInput(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: "whoknows" });

      expect(result).toMatchObject({
        errors: [
          {
            message:
              'Variable "$input" expected value of type "UnknownType!" which ' +
              "cannot be used as an input type.",
            locations: [{ line: 2, column: 24 }]
          }
        ]
      });
    });
  });

  describe("Handles default values", () => {
    test("allows inputs with default values to be omitted", async () => {
      const result = await executeQuery(`
        query {
          fieldWithDefaultInputValue(input: { a: "test" })
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithDefaultInputValue: '{ a: "test", b: "default" }'
        }
      });
    });

    test("allows inputs with default values to be ommited from variable", async () => {
      const result = await executeQuery(
        `
        query ($value: TestInputObjectWithDefaultValue!) {
          fieldWithDefaultInputValue(input: $value)
        }
      `,
        { value: { a: "test" } }
      );

      expect(result).toEqual({
        data: {
          fieldWithDefaultInputValue: '{ a: "test", b: "default" }'
        }
      });
    });
  });

  describe("Execute: Uses argument default values", () => {
    test("when no argument provided", async () => {
      const result = await executeQuery("{ fieldWithDefaultArgumentValue }");

      expect(result).toEqual({
        data: {
          fieldWithDefaultArgumentValue: '"Hello World"'
        }
      });
    });

    test("when omitted variable provided", async () => {
      const result = await executeQuery(`
        query ($optional: String) {
          fieldWithDefaultArgumentValue(input: $optional)
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithDefaultArgumentValue: '"Hello World"'
        }
      });
    });

    test("not when argument cannot be coerced", async () => {
      const result = await executeQuery(`
        {
          fieldWithDefaultArgumentValue(input: WRONG_TYPE)
        }
      `);

      expect(result).toMatchObject({
        errors: [
          {
            message:
              'Argument "input" of type "String" has invalid value WRONG_TYPE.',
            locations: [{ line: 3, column: 48 }]
          }
        ]
      });
    });

    test("when no runtime value is provided to a non-null argument", async () => {
      const result = await executeQuery(`
        query optionalVariable($optional: String) {
          fieldWithNonNullableStringInputAndDefaultArgumentValue(input: $optional)
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNonNullableStringInputAndDefaultArgumentValue:
            '"Hello World"'
        }
      });
    });
    test("when null is provided to a non-null argument with default argument", async () => {
      const result = await executeQuery(
        `
        query optionalVariable($optional: String) {
          fieldWithNonNullableStringInputAndDefaultArgumentValue(input: $optional)
        }
      `,
        { optional: null }
      );

      expect(result).toMatchObject({
        data: {
          fieldWithNonNullableStringInputAndDefaultArgumentValue: null
        },
        errors: [
          {
            message:
              'Argument "input" of non-null type "String!" must not be null.',
            locations: [{ line: 3, column: 73 }],
            path: ["fieldWithNonNullableStringInputAndDefaultArgumentValue"]
          }
        ]
      });
    });
  });
});
