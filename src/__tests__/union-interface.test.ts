/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/union-interface-test.js
 */
import {
  DocumentNode,
  GraphQLBoolean,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  GraphQLUnionType,
  parse
} from "graphql";

import { compileQuery } from "../index";

class Dog {
  constructor(public name: string, public barks: boolean) {}
}

class Cat {
  constructor(public name: string, public meows: boolean) {}
}

class Person {
  constructor(
    public name: string,
    public pets?: Array<Cat | Dog>,
    public friends?: Person[]
  ) {}
}

function execute(
  schema: GraphQLSchema,
  document: DocumentNode,
  root?: any,
  context?: any
) {
  const { query, errors }: any = compileQuery(schema, document, "");
  return query(root, context, {});
}

const NamedType = new GraphQLInterfaceType({
  name: "Named",
  fields: {
    name: { type: GraphQLString }
  }
});

const DogType = new GraphQLObjectType({
  name: "Dog",
  interfaces: [NamedType],
  fields: {
    name: { type: GraphQLString },
    barks: { type: GraphQLBoolean }
  },
  isTypeOf: value => value instanceof Dog
});

const CatType = new GraphQLObjectType({
  name: "Cat",
  interfaces: [NamedType],
  fields: {
    name: { type: GraphQLString },
    meows: { type: GraphQLBoolean }
  },
  isTypeOf: value => value instanceof Cat
});

const PetType = new GraphQLUnionType({
  name: "Pet",
  types: [DogType, CatType],
  resolveType(value) {
    if (value instanceof Dog) {
      return DogType;
    }
    if (value instanceof Cat) {
      return CatType;
    }
    return null;
  }
});

const PersonType = new GraphQLObjectType({
  name: "Person",
  interfaces: [NamedType],
  fields: {
    name: { type: GraphQLString },
    pets: { type: new GraphQLList(PetType) },
    friends: { type: new GraphQLList(NamedType) }
  },
  isTypeOf: value => value instanceof Person
});

const schema = new GraphQLSchema({
  query: PersonType,
  types: [PetType]
});

const garfield = new Cat("Garfield", false);
const odie = new Dog("Odie", true);
const liz = new Person("Liz");
const john = new Person("John", [garfield, odie], [liz, odie]);

// tslint:disable-next-line
describe("Execute: Union and intersection types", () => {
  test("can introspect on union and intersection types", () => {
    const ast = parse(`
      {
        Named: __type(name: "Named") {
          kind
          name
          fields { name }
          interfaces { name }
          possibleTypes { name }
          enumValues { name }
          inputFields { name }
        }
        Pet: __type(name: "Pet") {
          kind
          name
          fields { name }
          interfaces { name }
          possibleTypes { name }
          enumValues { name }
          inputFields { name }
        }
      }
    `);

    expect(execute(schema, ast)).toEqual({
      data: {
        Named: {
          kind: "INTERFACE",
          name: "Named",
          fields: [{ name: "name" }],
          interfaces: [],
          possibleTypes: [{ name: "Dog" }, { name: "Cat" }, { name: "Person" }],
          enumValues: null,
          inputFields: null
        },
        Pet: {
          kind: "UNION",
          name: "Pet",
          fields: null,
          interfaces: null,
          possibleTypes: [{ name: "Dog" }, { name: "Cat" }],
          enumValues: null,
          inputFields: null
        }
      }
    });
  });

  test("executes union types with inline fragments", () => {
    // This is the valid version of the query in the above test.
    const ast = parse(`
      {
        __typename
        name
        pets {
          __typename
          ... on Dog {
            name
            barks
          }
          ... on Cat {
            name
            meows
          }
        }
      }
    `);

    expect(execute(schema, ast, john)).toEqual({
      data: {
        __typename: "Person",
        name: "John",
        pets: [
          { __typename: "Cat", name: "Garfield", meows: false },
          { __typename: "Dog", name: "Odie", barks: true }
        ]
      }
    });
  });

  test("executes union types with inline fragments", () => {
    // This is the valid version of the query in the above test.
    const ast = parse(`
      {
        __typename
        name
        friends {
          __typename
          name
          ... on Dog {
            barks
          }
          ... on Cat {
            meows
          }
        }
      }
    `);

    expect(execute(schema, ast, john)).toEqual({
      data: {
        __typename: "Person",
        name: "John",
        friends: [
          { __typename: "Person", name: "Liz" },
          { __typename: "Dog", name: "Odie", barks: true }
        ]
      }
    });
  });

  test("allows fragment conditions to be abstract types", () => {
    const ast = parse(`
      {
        __typename
        name
        pets { ...PetFields }
        friends { ...FriendFields }
      }

      fragment PetFields on Pet {
        __typename
        ... on Dog {
          name
          barks
        }
        ... on Cat {
          name
          meows
        }
      }

      fragment FriendFields on Named {
        __typename
        name
        ... on Dog {
          barks
        }
        ... on Cat {
          meows
        }
      }
    `);

    expect(execute(schema, ast, john)).toEqual({
      data: {
        __typename: "Person",
        name: "John",
        pets: [
          { __typename: "Cat", name: "Garfield", meows: false },
          { __typename: "Dog", name: "Odie", barks: true }
        ],
        friends: [
          { __typename: "Person", name: "Liz" },
          { __typename: "Dog", name: "Odie", barks: true }
        ]
      }
    });
  });

  test("gets execution info in resolver", () => {
    let encounteredContext;
    let encounteredSchema;
    let encounteredRootValue;

    const NamedType2 = new GraphQLInterfaceType({
      name: "Named",
      fields: {
        name: { type: GraphQLString }
      },
      resolveType(_, context, { schema: receivedSchema, rootValue }) {
        encounteredContext = context;
        encounteredSchema = receivedSchema;
        encounteredRootValue = rootValue;
        return PersonType2;
      }
    });

    const PersonType2: GraphQLObjectType = new GraphQLObjectType({
      name: "Person",
      interfaces: [NamedType2],
      fields: {
        name: { type: GraphQLString },
        friends: { type: new GraphQLList(NamedType2) }
      }
    });

    const schema2 = new GraphQLSchema({
      query: PersonType2
    });

    const john2 = new Person("John", [], [liz]);

    const context = { authToken: "123abc" };

    const ast = parse("{ name, friends { name } }");

    expect(execute(schema2, ast, john2, context)).toEqual({
      data: { name: "John", friends: [{ name: "Liz" }] }
    });

    expect(encounteredContext).toEqual(context);
    expect(encounteredSchema).toEqual(schema2);
    expect(encounteredRootValue).toEqual(john2);
  });
});
