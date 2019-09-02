/**
 * Based on https://github.com/graphql/graphql-js/blob/master/src/execution/__tests__/abstract-test.js
 */

import {
  GraphQLBoolean,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLSchema,
  GraphQLString,
  GraphQLUnionType,
  parse
} from "graphql";
import { compileQuery, isCompiledQuery } from "../index";

function graphql(schema: GraphQLSchema, query: string) {
  const document = parse(query);
  const prepared = compileQuery(schema, document, "");
  if (!isCompiledQuery(prepared)) {
    return prepared;
  }
  return prepared.query(undefined, undefined, undefined);
}

class Dog {
  constructor(public name: string, public woofs: boolean, public other?: any) {}
}

class Cat {
  constructor(public name: string, public meows: boolean) {}
}

class Human {
  constructor(public name: string, public pets?: any) {}
}

// tslint:disable-next-line
describe("Execute: Handles execution of abstract types", () => {
  test("isTypeOf used to resolve runtime type for Interface", () => {
    const PetType = new GraphQLInterfaceType({
      name: "Pet",
      fields: {
        name: { type: GraphQLString }
      }
    });

    const DogType = new GraphQLObjectType({
      name: "Dog",
      interfaces: [PetType],
      isTypeOf: obj => obj instanceof Dog,
      fields: {
        name: { type: GraphQLString },
        woofs: { type: GraphQLBoolean }
      }
    });

    const CatType = new GraphQLObjectType({
      name: "Cat",
      interfaces: [PetType],
      isTypeOf: obj => obj instanceof Cat,
      fields: {
        name: { type: GraphQLString },
        meows: { type: GraphQLBoolean }
      }
    });

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          pets: {
            type: new GraphQLList(PetType),
            resolve() {
              return [new Dog("Odie", true), new Cat("Garfield", false)];
            }
          }
        }
      }),
      types: [CatType, DogType]
    });

    const query = `{
      pets {
        name
        ... on Dog {
          woofs
        }
        ... on Cat {
          meows
        }
      }
    }`;

    const result = graphql(schema, query);

    expect(result).toEqual({
      data: {
        pets: [
          {
            name: "Odie",
            woofs: true
          },
          {
            name: "Garfield",
            meows: false
          }
        ]
      }
    });
  });

  test("isTypeOf used to resolve runtime type for Union", () => {
    const DogType = new GraphQLObjectType({
      name: "Dog",
      isTypeOf: obj => obj instanceof Dog,
      fields: {
        name: { type: GraphQLString },
        woofs: { type: GraphQLBoolean }
      }
    });

    const CatType = new GraphQLObjectType({
      name: "Cat",
      isTypeOf: obj => obj instanceof Cat,
      fields: {
        name: { type: GraphQLString },
        meows: { type: GraphQLBoolean }
      }
    });

    const PetType = new GraphQLUnionType({
      name: "Pet",
      types: [DogType, CatType]
    });

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          pets: {
            type: new GraphQLList(PetType),
            resolve() {
              return [new Dog("Odie", true), new Cat("Garfield", false)];
            }
          }
        }
      })
    });

    const query = `{
      pets {
        ... on Dog {
          name
          woofs
        }
        ... on Cat {
          name
          meows
        }
      }
    }`;

    const result = graphql(schema, query);

    expect(result).toEqual({
      data: {
        pets: [
          {
            name: "Odie",
            woofs: true
          },
          {
            name: "Garfield",
            meows: false
          }
        ]
      }
    });
  });

  test("resolveType on Interface yields useful error", () => {
    const PetType: GraphQLInterfaceType = new GraphQLInterfaceType({
      name: "Pet",
      resolveType(obj) {
        return obj instanceof Dog
          ? DogType
          : obj instanceof Cat
          ? CatType
          : obj instanceof Human
          ? HumanType
          : null;
      },
      fields: {
        name: { type: GraphQLString }
      }
    });

    const HumanType = new GraphQLObjectType({
      name: "Human",
      fields: {
        name: { type: GraphQLString }
      }
    });

    const DogType = new GraphQLObjectType({
      name: "Dog",
      interfaces: [PetType],
      fields: {
        name: { type: GraphQLString },
        woofs: { type: GraphQLBoolean }
      }
    });

    const CatType = new GraphQLObjectType({
      name: "Cat",
      interfaces: [PetType],
      fields: {
        name: { type: GraphQLString },
        meows: { type: GraphQLBoolean }
      }
    });

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          pets: {
            type: new GraphQLList(PetType),
            resolve() {
              return [
                new Dog("Odie", true),
                new Cat("Garfield", false),
                new Human("Jon")
              ];
            }
          }
        }
      }),
      types: [CatType, DogType]
    });

    const query = `{
      pets {
        name
        ... on Dog {
          woofs
        }
        ... on Cat {
          meows
        }
      }
    }`;

    const result = graphql(schema, query);

    expect(result).toEqual({
      data: {
        pets: [
          {
            name: "Odie",
            woofs: true
          },
          {
            name: "Garfield",
            meows: false
          },
          null
        ]
      },
      errors: [
        {
          message:
            'Runtime Object type "Human" is not a possible type for "Pet".',
          locations: [{ line: 2, column: 7 }],
          path: ["pets", 2]
        }
      ]
    });
  });

  test("resolveType on Union yields useful error", () => {
    const HumanType = new GraphQLObjectType({
      name: "Human",
      fields: {
        name: { type: GraphQLString }
      }
    });

    const DogType = new GraphQLObjectType({
      name: "Dog",
      fields: {
        name: { type: GraphQLString },
        woofs: { type: GraphQLBoolean }
      }
    });

    const CatType = new GraphQLObjectType({
      name: "Cat",
      fields: {
        name: { type: GraphQLString },
        meows: { type: GraphQLBoolean }
      }
    });

    const PetType = new GraphQLUnionType({
      name: "Pet",
      // tslint:disable-next-line
      resolveType(obj) {
        return obj instanceof Dog
          ? DogType
          : obj instanceof Cat
          ? CatType
          : obj instanceof Human
          ? HumanType
          : null;
      },
      types: [DogType, CatType]
    });

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          pets: {
            type: new GraphQLList(PetType),
            // tslint:disable-next-line
            resolve() {
              return [
                new Dog("Odie", true),
                new Cat("Garfield", false),
                new Human("Jon")
              ];
            }
          }
        }
      })
    });

    const query = `{
      pets {
        ... on Dog {
          name
          woofs
        }
        ... on Cat {
          name
          meows
        }
      }
    }`;

    const result = graphql(schema, query);

    expect(result).toEqual({
      data: {
        pets: [
          {
            name: "Odie",
            woofs: true
          },
          {
            name: "Garfield",
            meows: false
          },
          null
        ]
      },
      errors: [
        {
          message:
            'Runtime Object type "Human" is not a possible type for "Pet".',
          locations: [{ line: 2, column: 7 }],
          path: ["pets", 2]
        }
      ]
    });
  });

  test("returning invalid value from resolveType yields useful error", () => {
    const fooInterface = new GraphQLInterfaceType({
      name: "FooInterface",
      fields: { bar: { type: GraphQLString } },
      resolveType: () => []
    } as any);

    const fooObject = new GraphQLObjectType({
      name: "FooObject",
      fields: { bar: { type: GraphQLString } },
      interfaces: [fooInterface]
    });

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          foo: {
            type: fooInterface,
            resolve: () => "dummy"
          }
        }
      }),
      types: [fooObject]
    });

    const result = graphql(schema, "{ foo { bar } }");

    expect(result).toEqual({
      data: { foo: null },
      errors: [
        {
          message:
            "Abstract type FooInterface must resolve to an Object type at " +
            "runtime for field Query.foo. " +
            'Either the FooInterface type should provide a "resolveType" ' +
            'function or each possible types should provide an "isTypeOf" function.',
          locations: [{ line: 1, column: 3 }],
          path: ["foo"]
        }
      ]
    });
  });

  test("resolveType allows resolving with type name", () => {
    const PetType = new GraphQLInterfaceType({
      name: "Pet",
      resolveType(obj) {
        return obj instanceof Dog ? "Dog" : obj instanceof Cat ? "Cat" : null;
      },
      fields: {
        name: { type: GraphQLString }
      }
    });

    const DogType = new GraphQLObjectType({
      name: "Dog",
      interfaces: [PetType],
      fields: {
        name: { type: GraphQLString },
        woofs: { type: GraphQLBoolean }
      }
    });

    const CatType = new GraphQLObjectType({
      name: "Cat",
      interfaces: [PetType],
      fields: {
        name: { type: GraphQLString },
        meows: { type: GraphQLBoolean }
      }
    });

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          pets: {
            type: new GraphQLList(PetType),
            resolve() {
              return [new Dog("Odie", true), new Cat("Garfield", false)];
            }
          }
        }
      }),
      types: [CatType, DogType]
    });

    const query = `{
      pets {
        name
        ... on Dog {
          woofs
        }
        ... on Cat {
          meows
        }
      }
    }`;

    const result = graphql(schema, query);

    expect(result).toEqual({
      data: {
        pets: [
          {
            name: "Odie",
            woofs: true
          },
          {
            name: "Garfield",
            meows: false
          }
        ]
      }
    });
  });

  test("complex schema with abstract types", async () => {
    let nestedInfo: GraphQLResolveInfo | undefined;
    const CatType = new GraphQLObjectType({
      name: "Cat",
      fields: {
        name: { type: GraphQLString },
        meows: {
          type: GraphQLBoolean,
          resolve: (obj, _, _1, info) => {
            nestedInfo = info;
            return Promise.resolve(obj.meows);
          }
        }
      }
    });

    const DogType: GraphQLObjectType = new GraphQLObjectType({
      name: "Dog",
      fields: {
        name: { type: GraphQLString },
        woofs: { type: GraphQLBoolean },
        other: {
          type: new GraphQLObjectType({
            name: "Other",
            fields: {
              nested: {
                type: new GraphQLObjectType({
                  name: "Nested",
                  fields: {
                    friend: {
                      type: new GraphQLUnionType({
                        name: "DogFriend",
                        // tslint:disable-next-line
                        resolveType(obj) {
                          return obj instanceof Dog
                            ? DogType
                            : obj instanceof Cat
                            ? CatType
                            : obj instanceof Human
                            ? HumanType
                            : null;
                        },
                        types: [CatType]
                      })
                    }
                  }
                })
              }
            }
          })
        }
      }
    });

    const PetType = new GraphQLUnionType({
      name: "Pet",
      // tslint:disable-next-line
      resolveType(obj) {
        return obj instanceof Dog
          ? DogType
          : obj instanceof Cat
          ? CatType
          : obj instanceof Human
          ? HumanType
          : null;
      },
      types: [DogType, CatType]
    });

    const HumanType: GraphQLObjectType = new GraphQLObjectType({
      name: "Human",
      fields: {
        name: { type: GraphQLString },
        pets: {
          type: new GraphQLList(PetType)
        }
      }
    });

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          owner: {
            type: HumanType,
            resolve: () =>
              Promise.resolve(
                new Human("Jon", [
                  new Dog("Odie", true, {
                    nested: {
                      friend: new Cat("Garfield", false)
                    }
                  }),
                  new Cat("Garfield", false),
                  new Human("Jon")
                ])
              )
          }
        }
      })
    });

    const query = `{
      owner {
        pets {
          ... on Dog {
            name
            woofs
            other {
              nested {
                friend {
                  ... on Cat {
                    name
                    meows
                  }
                }
              }
            }
          }
        }
      }
    }`;

    const result = await graphql(schema, query);

    expect(result).toEqual({
      data: {
        owner: {
          pets: [
            {
              name: "Odie",
              woofs: true,
              other: {
                nested: {
                  friend: { name: "Garfield", meows: false }
                }
              }
            },
            {},
            null
          ]
        }
      },
      errors: [
        {
          message:
            'Runtime Object type "Human" is not a possible type for "Pet".',
          locations: [{ line: 3, column: 9 }],
          path: ["owner", "pets", 2]
        }
      ]
    });
    expect(nestedInfo).toBeDefined();
    if (nestedInfo) {
      expect(nestedInfo.path).toEqual({
        key: "meows",
        prev: {
          key: "friend",
          prev: {
            key: "nested",
            prev: {
              key: "other",
              prev: {
                key: 0,
                prev: {
                  key: "pets",
                  prev: {
                    key: "owner",
                    prev: undefined
                  }
                }
              }
            }
          }
        }
      });
    }
  });
});
