/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/variables-test.js
 */

/* tslint:disable:no-big-function */
import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";
import { GraphQLArgumentConfig } from "graphql/type/definition";
import { compileQuery } from "../index";
import inspect from "../inspect";

const TestComplexScalar = new GraphQLScalarType({
  name: "ComplexScalar",
  serialize(value: any) {
    if (value === "DeserializedValue") {
      return "SerializedValue";
    }
    return null;
  },
  // tslint:disable-next-line
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

const TestInputObject = new GraphQLInputObjectType({
  name: "TestInputObject",
  fields: {
    a: { type: GraphQLString },
    b: { type: new GraphQLList(GraphQLString) },
    c: { type: new GraphQLNonNull(GraphQLString) },
    d: { type: TestComplexScalar }
  }
});

const TestNestedInputObject = new GraphQLInputObjectType({
  name: "TestNestedInputObject",
  fields: {
    na: { type: new GraphQLNonNull(TestInputObject) },
    nb: { type: new GraphQLNonNull(GraphQLString) }
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
    fieldWithObjectInput: fieldWithInputArg({ type: TestInputObject }),
    fieldWithNullableStringInput: fieldWithInputArg({ type: GraphQLString }),
    fieldWithNonNullableStringInput: fieldWithInputArg({
      type: new GraphQLNonNull(GraphQLString)
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
      type: TestNestedInputObject,
      defaultValue: "Hello World"
    }),
    list: fieldWithInputArg({ type: new GraphQLList(GraphQLString) }),
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

function executeQuery(query: string, variableValues?: any) {
  const document = parse(query);
  const prepared: any = compileQuery(schema, document, "", {enableVariableCompilation: true});
  if (prepared.errors) {
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

        expect(result).toEqual({
          errors: [
            {
              message:
                'Argument "input" of type "TestInputObject" has invalid value ["foo", "bar", "baz"].',
              locations: [{ line: 3, column: 41 }]
            }
          ]
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

        const noVal = Object.create(null);
        noVal.a = "foo";
        noVal.b = ["bar"];
        noVal.c = "baz";

        expect(result).toEqual({
          data: {
            fieldWithObjectInput: inspect(noVal)
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

      test("errors on null for nested non-null", async () => {
        const params = { input: { a: "foo", b: "bar", c: null } };
        const result = await executeQuery(doc, params);

        expect(result).toEqual({
          errors: [
            {
              message:
                "Variable \"$input\" got invalid value { a: \"foo\", b: \"bar\", c: null }; " +
                "Expected non-nullable type String! not to be null at value.c.",
              locations: [{ line: 2, column: 16 }]
            }
          ]
        });
      });

      test("errors on incorrect type", async () => {
        const result = await executeQuery(doc, { input: "foo bar" });

        expect(result).toEqual({
          errors: [
            {
              message:
                "Variable \"$input\" got invalid value \"foo bar\"; " +
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

        expect(result).toEqual({
          errors: [
            {
              message:
                "Variable \"$input\" got invalid value { a: \"foo\", b: \"bar\" }; " +
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

        expect(result).toEqual({
          errors: [
            {
              message:
                  'Variable "$input" got invalid value { a: "foo", b: "bar", c: "baz", extra: "dog" }; Field "extra" is not defined by type TestInputObject.',
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
          defaultValue: '"DEFAULT_VALUE"',
        },
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
  });

  describe("Handles nullable scalars", () => {
    test("allows nullable inputs to be omitted", async () => {
      const result = await executeQuery(`
        {
          fieldWithNullableStringInput
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: null
        }
      });
    });

    test("allows nullable inputs to be omitted in a variable", async () => {
      const result = await executeQuery(`
        query ($value: String) {
          fieldWithNullableStringInput(input: $value)
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: null
        }
      });
    });

    test("allows nullable inputs to be omitted in an unlisted variable", async () => {
      const result = await executeQuery(`
        query {
          fieldWithNullableStringInput(input: $value)
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: null
        }
      });
    });

    test("allows nullable inputs to be set to null in a variable", async () => {
      const doc = `
        query ($value: String) {
          fieldWithNullableStringInput(input: $value)
        }
      `;
      const result = await executeQuery(doc, { value: null });

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: "null"
        }
      });
    });

    test("allows nullable inputs to be set to a value in a variable", async () => {
      const doc = `
        query ($value: String) {
          fieldWithNullableStringInput(input: $value)
        }
      `;
      const result = await executeQuery(doc, { value: "a" });

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: '"a"'
        }
      });
    });

    test("allows nullable inputs to be set to a value directly", async () => {
      const result = await executeQuery(`
        {
          fieldWithNullableStringInput(input: "a")
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNullableStringInput: '"a"'
        }
      });
    });
  });

  describe("Handles non-nullable scalars", () => {
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
      const result = await executeQuery(`
        query ($value: String!) {
          fieldWithNonNullableStringInput(input: $value)
        }
      `);

      expect(result).toEqual({
        errors: [
          {
            message:
              'Variable "$value" of required type "String!" was not provided.',
            locations: [{ line: 2, column: 16 }]
          }
        ]
      });
    });

    test("does not allow non-nullable inputs to be set to null in a variable", async () => {
      const doc = `
        query ($value: String!) {
          fieldWithNonNullableStringInput(input: $value)
        }
      `;
      const result = await executeQuery(doc, { value: null });

      expect(result).toEqual({
        errors: [
          {
            message:
              'Variable "$value" of non-null type "String!" must not be null.',
            locations: [{ line: 2, column: 16 }]
          }
        ]
      });
    });

    test("allows non-nullable inputs to be set to a value in a variable", async () => {
      const doc = `
        query ($value: String!) {
          fieldWithNonNullableStringInput(input: $value)
        }
      `;
      const result = await executeQuery(doc, { value: "a" });

      expect(result).toEqual({
        data: {
          fieldWithNonNullableStringInput: '"a"'
        }
      });
    });

    test("allows non-nullable inputs to be set to a value directly", async () => {
      const result = await executeQuery(`
        {
          fieldWithNonNullableStringInput(input: "a")
        }
      `);

      expect(result).toEqual({
        data: {
          fieldWithNonNullableStringInput: '"a"'
        }
      });
    });

    test("reports error for missing non-nullable inputs", async () => {
      const result = await executeQuery("{ fieldWithNonNullableStringInput }");

      expect(result).toEqual({
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

      expect(result).toEqual({
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

    it.skip("reports error for non-provided variables for non-nullable inputs", async () => {
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

      expect(result).toEqual({
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

    test("does not allow non-null lists to be null", async () => {
      const doc = `
        query ($input: [String]!) {
          nnList(input: $input)
        }
      `;
      const result = await executeQuery(doc, { input: null });

      expect(result).toEqual({
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

      expect(result).toEqual({
        errors: [
          {
            message:
              "Variable \"$input\" got invalid value [\"A\", null, \"B\"]; " +
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

      expect(result).toEqual({
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

      expect(result).toEqual({
        errors: [
          {
            message:
              "Variable \"$input\" got invalid value [\"A\", null, \"B\"]; " +
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

      expect(result).toEqual({
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

      expect(result).toEqual({
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

      expect(result).toEqual({
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
  });
});
