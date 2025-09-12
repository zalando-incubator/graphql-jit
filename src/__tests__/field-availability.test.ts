import { makeExecutableSchema } from "@graphql-tools/schema";
import { Kind, parse } from "graphql";
import { isCompiledQuery } from "../execution";
import { compileQuery } from "../index";
import {
  type GraphQLJitResolveInfoWithAvailability,
  createFieldAvailability
} from "../resolve-info-enhanced";
import { type JitFieldNode } from "../ast";

describe("Field Availability", () => {
  let resolverInfo: GraphQLJitResolveInfoWithAvailability | null = null;
  let resolverCalls: any[] = [];

  beforeEach(() => {
    resolverInfo = null;
    resolverCalls = [];
  });

  const createMockResolver = (name: string) => {
    return jest.fn(
      (
        parent: any,
        args: any,
        context: any,
        info: GraphQLJitResolveInfoWithAvailability
      ) => {
        resolverCalls.push({ name, parent, args, context });
        resolverInfo = info;

        const result: any = { id: `${name}-123` };

        if (info.isFieldRequested("name")) result.name = `${name} Name`;
        if (info.isFieldRequested("email")) result.email = `${name}@test.com`;
        if (info.isFieldRequested("phone")) result.phone = `${name}-phone`;
        if (info.isFieldRequested("profile"))
          result.profile = { bio: `${name} bio` };
        if (info.isFieldRequested("posts"))
          result.posts = [{ title: `${name} post` }];

        return result;
      }
    );
  };

  describe("Basic Skip/Include Functionality", () => {
    test("@skip with variable - true", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($skip: Boolean!) {
          user {
            id
            name
            email @skip(if: $skip)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, { skip: true });

      expect(resolverInfo!.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true],
          ["email", false]
        ])
      );
      expect(resolverInfo!.isFieldRequested("email")).toBe(false);
    });

    test("@skip with variable - false", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($skip: Boolean!) {
          user {
            id
            name
            email @skip(if: $skip)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, { skip: false });

      expect(resolverInfo!.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true],
          ["email", true]
        ])
      );
      expect(resolverInfo!.isFieldRequested("email")).toBe(true);
    });

    test("@include with variable - true", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($include: Boolean!) {
          user {
            id
            name
            email @include(if: $include)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, { include: true });

      expect(resolverInfo!.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true],
          ["email", true]
        ])
      );
      expect(resolverInfo!.isFieldRequested("email")).toBe(true);
    });

    test("@include with variable - false", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($include: Boolean!) {
          user {
            id
            name
            email @include(if: $include)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, { include: false });

      expect(resolverInfo!.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true],
          ["email", false]
        ])
      );
      expect(resolverInfo!.isFieldRequested("email")).toBe(false);
    });
  });

  describe("Static Boolean Directives", () => {
    test("@skip with static true", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test {
          user {
            id
            name
            email @skip(if: true)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {});

      expect(resolverInfo!.fieldAvailability.get("email")).toBe(false);
      expect(resolverInfo!.isFieldRequested("email")).toBe(false);
    });

    test("@skip with static false", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test {
          user {
            id
            name
            email @skip(if: false)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {});

      expect(resolverInfo!.fieldAvailability.get("email")).toBe(true);
      expect(resolverInfo!.isFieldRequested("email")).toBe(true);
    });

    test("@include with static true", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test {
          user {
            id
            name
            email @include(if: true)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {});

      expect(resolverInfo!.fieldAvailability.get("email")).toBe(true);
      expect(resolverInfo!.isFieldRequested("email")).toBe(true);
    });

    test("@include with static false", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test {
          user {
            id
            name
            email @include(if: false)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {});

      expect(resolverInfo!.fieldAvailability.get("email")).toBe(false);
      expect(resolverInfo!.isFieldRequested("email")).toBe(false);
    });
  });

  describe("Combined Skip and Include Directives", () => {
    test("@skip(false) @include(true) - field should be included", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($skip: Boolean!, $include: Boolean!) {
          user {
            id
            email @skip(if: $skip) @include(if: $include)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {
        skip: false,
        include: true
      });

      expect(resolverInfo!.fieldAvailability.get("email")).toBe(true);
      expect(resolverInfo!.isFieldRequested("email")).toBe(true);
    });

    test("@skip(true) @include(true) - field should be skipped", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($skip: Boolean!, $include: Boolean!) {
          user {
            id
            email @skip(if: $skip) @include(if: $include)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {
        skip: true,
        include: true
      });

      expect(resolverInfo!.fieldAvailability.get("email")).toBe(false);
      expect(resolverInfo!.isFieldRequested("email")).toBe(false);
    });

    test("@skip(false) @include(false) - field should be excluded", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($skip: Boolean!, $include: Boolean!) {
          user {
            id
            email @skip(if: $skip) @include(if: $include)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {
        skip: false,
        include: false
      });

      expect(resolverInfo!.fieldAvailability.get("email")).toBe(false);
      expect(resolverInfo!.isFieldRequested("email")).toBe(false);
    });

    test("@skip(true) @include(false) - field should be skipped", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($skip: Boolean!, $include: Boolean!) {
          user {
            id
            email @skip(if: $skip) @include(if: $include)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {
        skip: true,
        include: false
      });

      expect(resolverInfo!.fieldAvailability.get("email")).toBe(false);
      expect(resolverInfo!.isFieldRequested("email")).toBe(false);
    });
  });

  describe("Complex Scenarios", () => {
    test("Multiple fields with different directive combinations", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User {
            id: String
            name: String
            email: String
            phone: String
            profile: Profile
          }
          type Profile { bio: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($skipEmail: Boolean!, $includePhone: Boolean!, $skipProfile: Boolean!) {
          user {
            id
            name
            email @skip(if: $skipEmail)
            phone @include(if: $includePhone)
            profile @skip(if: $skipProfile) {
              bio
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {
        skipEmail: true,
        includePhone: false,
        skipProfile: true
      });

      expect(resolverInfo!.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true],
          ["email", false],
          ["phone", false],
          ["profile", false]
        ])
      );
    });

    test("Nested object fields with directives", () => {
      const userResolver = createMockResolver("user");
      const profileResolver = jest.fn(
        (
          parent: any,
          args: any,
          context: any,
          info: GraphQLJitResolveInfoWithAvailability
        ) => {
          resolverInfo = info; // Capture nested resolver info
          return {
            bio: info.isFieldRequested("bio") ? "User bio" : undefined,
            avatar: info.isFieldRequested("avatar") ? "avatar.jpg" : undefined
          };
        }
      );

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User {
            id: String
            name: String
            profile: Profile
          }
          type Profile {
            bio: String
            avatar: String
          }
        `,
        resolvers: {
          Query: { user: userResolver },
          User: { profile: profileResolver }
        }
      });

      const query = `
        query Test($skipBio: Boolean!) {
          user {
            id
            name
            profile {
              bio @skip(if: $skipBio)
              avatar
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, { skipBio: true });

      // Check nested profile resolver received correct info
      expect(resolverInfo!.fieldAvailability).toEqual(
        new Map([
          ["bio", false],
          ["avatar", true]
        ])
      );
      expect(resolverInfo!.isFieldRequested("bio")).toBe(false);
      expect(resolverInfo!.isFieldRequested("avatar")).toBe(true);
    });

    test("Field aliases with directives", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User {
            id: String
            name: String
            email: String
          }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($skip: Boolean!) {
          user {
            id
            fullName: name
            userEmail: email @skip(if: $skip)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, { skip: true });

      expect(resolverInfo!.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true], // real field name, not alias "fullName"
          ["email", false] // real field name, not alias "userEmail"
        ])
      );
      expect(resolverInfo!.isFieldRequested("email")).toBe(false); // check real field name
      expect(resolverInfo!.isFieldRequested("name")).toBe(true); // check real field name
    });

    test("List fields with directives", () => {
      const userResolver = createMockResolver("user");
      const postsResolver = jest.fn(
        (
          parent: any,
          args: any,
          context: any,
          info: GraphQLJitResolveInfoWithAvailability
        ) => {
          resolverInfo = info;
          return [
            {
              title: info.isFieldRequested("title") ? "Post 1" : undefined,
              content: info.isFieldRequested("content")
                ? "Content 1"
                : undefined
            }
          ];
        }
      );

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User {
            id: String
            posts: [Post]
          }
          type Post {
            title: String
            content: String
          }
        `,
        resolvers: {
          Query: { user: userResolver },
          User: { posts: postsResolver }
        }
      });

      const query = `
        query Test($skipContent: Boolean!) {
          user {
            id
            posts {
              title
              content @skip(if: $skipContent)
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, { skipContent: true });

      expect(resolverInfo!.fieldAvailability).toEqual(
        new Map([
          ["title", true],
          ["content", false]
        ])
      );
      expect(resolverInfo!.isFieldRequested("content")).toBe(false);
    });
  });

  describe("Direct createFieldAvailability Function", () => {
    test("should return empty map for empty field nodes", () => {
      const result = createFieldAvailability([], {});
      expect(result).toEqual(new Map());
    });

    test("should handle field nodes without selection sets", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "scalarField" },
          selectionSet: undefined
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result).toEqual(new Map());
    });

    test("should handle fields with __internalShouldIncludePath", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ['variableValues["includeEmail"] === true']
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {
        includeEmail: true
      });
      expect(result.get("email")).toBe(true);

      const result2 = createFieldAvailability(mockFieldNodes, {
        includeEmail: false
      });
      expect(result2.get("email")).toBe(false);
    });

    test("should handle fields with __internalShouldInclude (old format)", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldInclude: [
                  'variableValues["includeEmail"] === true'
                ]
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {
        includeEmail: true
      });
      expect(result.get("email")).toBe(true);

      const result2 = createFieldAvailability(mockFieldNodes, {
        includeEmail: false
      });
      expect(result2.get("email")).toBe(false);
    });

    test("should handle multiple field occurrences with OR logic", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ['variableValues["condition1"] === true']
                }
              } as JitFieldNode,
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ['variableValues["condition2"] === true']
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      // Test OR logic: if either condition is true, field should be included
      const result1 = createFieldAvailability(mockFieldNodes, {
        condition1: true,
        condition2: false
      });
      expect(result1.get("email")).toBe(true);

      const result2 = createFieldAvailability(mockFieldNodes, {
        condition1: false,
        condition2: true
      });
      expect(result2.get("email")).toBe(true);

      const result3 = createFieldAvailability(mockFieldNodes, {
        condition1: false,
        condition2: false
      });
      expect(result3.get("email")).toBe(false);
    });

    test("should handle error in condition evaluation", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: "SelectionSet" as any,
            selections: [
              {
                kind: "Field" as any,
                name: { kind: "Name" as any, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ["invalid javascript syntax"]
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result.get("email")).toBe(true); // Safety default when error occurs
    });

    test("should handle fields with fallback path matching", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "other.path": ['variableValues["includeEmail"] === true']
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      // Should use fallback path when current path doesn't match
      const result = createFieldAvailability(mockFieldNodes, {
        includeEmail: true
      });
      expect(result.get("email")).toBe(true);
    });

    test("should handle empty path conditions", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {}
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result.get("email")).toBe(true); // Should default to true when no conditions
    });

    test('should handle condition with "true" literal', () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": [
                    "true",
                    'variableValues["includeEmail"] === true'
                  ]
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {
        includeEmail: true
      });
      expect(result.get("email")).toBe(true);

      const result2 = createFieldAvailability(mockFieldNodes, {
        includeEmail: false
      });
      expect(result2.get("email")).toBe(false);
    });

    test("should handle parent exclusion properly", () => {
      const mockFieldNodes: JitFieldNode[] = [];

      const { createFieldAvailability } = require("../resolve-info-enhanced");

      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result).toEqual(new Map());
    });
  });

  describe("Direct generateFieldAvailabilityCode Function", () => {
    test("should handle fields with @skip directive", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "skip" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.VARIABLE,
                          name: { kind: Kind.NAME, value: "skipEmail" }
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('!(variableValues["skipEmail"] === true)');
    });

    test("should handle fields with @include directive", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "include" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.BOOLEAN,
                          value: true
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true');
    });

    test("should handle fields with no directives", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: []
              }
            ]
          }
        } as JitFieldNode
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true');
    });
    test("should handle @skip directive with boolean literal", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "skip" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.BOOLEAN,
                          value: false
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      // @skip(if: false) should result in field being included
      expect(result).toContain('"email": !false');
    });

    test("should handle @include directive with boolean literal", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "include" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.BOOLEAN,
                          value: true
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true');
    });

    test("should handle multiple conditions combined with &&", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "skip" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.VARIABLE,
                          name: { kind: Kind.NAME, value: "skipEmail" }
                        }
                      }
                    ]
                  },
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "include" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.VARIABLE,
                          name: { kind: Kind.NAME, value: "includeEmail" }
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain("&&");
      expect(result).toContain('!(variableValues["skipEmail"] === true)');
      expect(result).toContain('(variableValues["includeEmail"] === true)');
    });

    test("should handle path-based conditions with matching currentPath", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ['variableValues["includeEmail"] === true'],
                  "fallback.path": ['variableValues["fallback"] === true']
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('variableValues["includeEmail"] === true');
    });

    test("should handle path-based conditions with fallback path", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                __internalShouldIncludePath: {
                  "other.path": ['variableValues["fallback"] === true']
                },
                name: { kind: Kind.NAME, value: "email" }
              } as JitFieldNode
            ]
          }
        }
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('variableValues["fallback"] === true');
    });

    test("should handle expressions with only true values", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ["true", "true"]
                }
              } as JitFieldNode
            ]
          }
        }
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true'); // Should simplify to true when all expressions are "true"
    });

    test("should handle fields with no directives", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: undefined
              }
            ]
          }
        } as JitFieldNode
      ];

      const {
        generateFieldAvailabilityCode
      } = require("../resolve-info-enhanced");
      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true');
    });
  });

  describe("Fragment Handling in createFieldAvailability", () => {
    test("should handle fragment spreads in createFieldAvailability", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FRAGMENT_SPREAD,
                name: { kind: Kind.NAME, value: "UserFragment" }
              }
            ]
          }
        } as JitFieldNode
      ];

      const { createFieldAvailability } = require("../resolve-info-enhanced");
      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result).toEqual(new Map()); // Should skip fragment spreads
    });

    test("should handle inline fragments in createFieldAvailability", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.INLINE_FRAGMENT,
                selectionSet: {
                  kind: Kind.SELECTION_SET,
                  selections: []
                }
              }
            ]
          }
        } as JitFieldNode
      ];

      const { createFieldAvailability } = require("../resolve-info-enhanced");
      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result).toEqual(new Map()); // Should skip inline fragments
    });
  });

  describe("Complex GraphQL Query Integration Tests", () => {
    let userResolverInfo: GraphQLJitResolveInfoWithAvailability | null = null;
    let profileResolverInfo: GraphQLJitResolveInfoWithAvailability | null =
      null;
    let settingsResolverInfo: GraphQLJitResolveInfoWithAvailability | null =
      null;
    let notificationsResolverInfo: GraphQLJitResolveInfoWithAvailability | null =
      null;
    let privacyResolverInfo: GraphQLJitResolveInfoWithAvailability | null =
      null;

    beforeEach(() => {
      userResolverInfo = null;
      profileResolverInfo = null;
      settingsResolverInfo = null;
      notificationsResolverInfo = null;
      privacyResolverInfo = null;
    });

    const complexSchema = makeExecutableSchema({
      typeDefs: `
        type Query {
          user(id: ID!): User
          posts(limit: Int): [Post]
          search(query: String!): SearchResult
        }

        type User {
          id: ID!
          username: String!
          email: String
          profile: UserProfile
          posts: [Post]
          friends: [User]
          settings: UserSettings
        }

        type UserProfile {
          firstName: String
          lastName: String
          avatar: String
          bio: String
          location: String
          website: String
        }

        type UserSettings {
          theme: String
          notifications: NotificationSettings
          privacy: PrivacySettings
        }

        type NotificationSettings {
          email: Boolean
          push: Boolean
          sms: Boolean
        }

        type PrivacySettings {
          profileVisibility: String
          showEmail: Boolean
          showLocation: Boolean
        }

        type Post {
          id: ID!
          title: String!
          content: String
          author: User
          comments: [Comment]
          tags: [String]
          published: Boolean
          createdAt: String
        }

        type Comment {
          id: ID!
          content: String!
          author: User
          post: Post
          replies: [Comment]
        }

        union SearchResult = User | Post
      `,
      resolvers: {
        Query: {
          user: jest.fn(
            (_, args, __, info: GraphQLJitResolveInfoWithAvailability) => {
              userResolverInfo = info;
              return {
                id: args.id,
                username: info.isFieldRequested("username")
                  ? "testuser"
                  : undefined,
                email: info.isFieldRequested("email")
                  ? "test@example.com"
                  : undefined,
                profile: info.isFieldRequested("profile") ? {} : undefined,
                posts: info.isFieldRequested("posts") ? [] : undefined,
                friends: info.isFieldRequested("friends") ? [] : undefined,
                settings: info.isFieldRequested("settings") ? {} : undefined
              };
            }
          ),
          posts: jest.fn(
            (_, args, __, info: GraphQLJitResolveInfoWithAvailability) => {
              resolverInfo = info;
              return [];
            }
          ),
          search: jest.fn(
            (_, args, __, info: GraphQLJitResolveInfoWithAvailability) => {
              resolverInfo = info;
              return { __typename: "User", id: "1" };
            }
          )
        },
        User: {
          profile: jest.fn(
            (parent, _, __, info: GraphQLJitResolveInfoWithAvailability) => {
              profileResolverInfo = info;
              return {
                firstName: info.isFieldRequested("firstName")
                  ? "John"
                  : undefined,
                lastName: info.isFieldRequested("lastName") ? "Doe" : undefined,
                avatar: info.isFieldRequested("avatar")
                  ? "avatar.jpg"
                  : undefined,
                bio: info.isFieldRequested("bio")
                  ? "Software engineer"
                  : undefined,
                location: info.isFieldRequested("location")
                  ? "San Francisco"
                  : undefined,
                website: info.isFieldRequested("website")
                  ? "https://johndoe.com"
                  : undefined
              };
            }
          ),
          settings: jest.fn(
            (parent, _, __, info: GraphQLJitResolveInfoWithAvailability) => {
              settingsResolverInfo = info;
              return {
                theme: info.isFieldRequested("theme") ? "dark" : undefined,
                notifications: info.isFieldRequested("notifications")
                  ? {}
                  : undefined,
                privacy: info.isFieldRequested("privacy") ? {} : undefined
              };
            }
          )
        },
        UserSettings: {
          notifications: jest.fn(
            (parent, _, __, info: GraphQLJitResolveInfoWithAvailability) => {
              notificationsResolverInfo = info;
              return {
                email: info.isFieldRequested("email") ? true : undefined,
                push: info.isFieldRequested("push") ? false : undefined,
                sms: info.isFieldRequested("sms") ? true : undefined
              };
            }
          ),
          privacy: jest.fn(
            (parent, _, __, info: GraphQLJitResolveInfoWithAvailability) => {
              privacyResolverInfo = info;
              return {
                profileVisibility: info.isFieldRequested("profileVisibility")
                  ? "public"
                  : undefined,
                showEmail: info.isFieldRequested("showEmail")
                  ? false
                  : undefined,
                showLocation: info.isFieldRequested("showLocation")
                  ? true
                  : undefined
              };
            }
          )
        }
      }
    });

    test("deeply nested query with conditional fields", () => {
      const query = `
        query GetUser($includeProfile: Boolean!, $showPrivateInfo: Boolean!) {
          user(id: "1") {
            id
            username
            email @include(if: $showPrivateInfo)
            profile @include(if: $includeProfile) {
              firstName
              lastName
              avatar
              bio @skip(if: $showPrivateInfo)
              location @include(if: $showPrivateInfo)
              website
            }
            settings {
              theme
              notifications @include(if: $showPrivateInfo) {
                email
                push
                sms @skip(if: $showPrivateInfo)
              }
              privacy @include(if: $showPrivateInfo) {
                profileVisibility
                showEmail
                showLocation
              }
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(complexSchema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      // Test with both conditions true
      compiled.query({}, undefined, {
        includeProfile: true,
        showPrivateInfo: true
      });

      // Check user resolver field availability - includes all fields from the query
      expect(userResolverInfo!.fieldAvailability.get("id")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("username")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("email")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("profile")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("settings")).toBe(true);

      // Check profile resolver field availability - only sees immediate children of Profile type
      expect(profileResolverInfo!.fieldAvailability.get("firstName")).toBe(
        true
      );
      expect(profileResolverInfo!.fieldAvailability.get("lastName")).toBe(true);
      expect(profileResolverInfo!.fieldAvailability.get("avatar")).toBe(true);
      expect(profileResolverInfo!.fieldAvailability.get("bio")).toBe(false); // skipped when showPrivateInfo is true
      expect(profileResolverInfo!.fieldAvailability.get("location")).toBe(true); // included when showPrivateInfo is true
      expect(profileResolverInfo!.fieldAvailability.get("website")).toBe(true);

      // Check privacy resolver field availability - only sees immediate children of PrivacySettings type
      expect(
        privacyResolverInfo!.fieldAvailability.get("profileVisibility")
      ).toBe(true);
      expect(privacyResolverInfo!.fieldAvailability.get("showEmail")).toBe(
        true
      );
      expect(privacyResolverInfo!.fieldAvailability.get("showLocation")).toBe(
        true
      );

      // Test with mixed conditions
      compiled.query({}, undefined, {
        includeProfile: false,
        showPrivateInfo: true
      });

      expect(userResolverInfo!.fieldAvailability.get("id")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("username")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("email")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("profile")).toBe(false);
      expect(userResolverInfo!.fieldAvailability.get("settings")).toBe(true);
    });

    test("complex query with multiple directive combinations", () => {
      const query = `
        query ComplexQuery($showUser: Boolean!, $hideEmail: Boolean!, $includeSettings: Boolean!) {
          user(id: "1") @include(if: $showUser) {
            id
            username
            email @skip(if: $hideEmail) @include(if: $showUser)
            profile {
              firstName @include(if: $showUser)
              lastName
              bio @skip(if: $hideEmail)
            }
            settings @include(if: $includeSettings) {
              theme
              notifications @skip(if: $hideEmail) {
                email
                push
              }
            }
          }
          posts @skip(if: $showUser) {
            id
            title
            published @include(if: $includeSettings)
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(complexSchema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      compiled.query({}, undefined, {
        showUser: true,
        hideEmail: false,
        includeSettings: true
      });

      // Test user resolver field availability
      expect(userResolverInfo!.fieldAvailability.get("id")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("username")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("email")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("profile")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("settings")).toBe(true);

      // Test profile resolver field availability
      expect(profileResolverInfo!.fieldAvailability.get("firstName")).toBe(
        true
      );
      expect(profileResolverInfo!.fieldAvailability.get("lastName")).toBe(true);
      expect(profileResolverInfo!.fieldAvailability.get("bio")).toBe(true); // not hidden since hideEmail is false
    });

    test("deeply nested conditional fields with aliases", () => {
      const query = `
        query NestedQuery($includePersonal: Boolean!, $showPrivate: Boolean!) {
          currentUser: user(id: "1") {
            userId: id
            displayName: username
            contactEmail: email @include(if: $showPrivate)
            personalInfo: profile @include(if: $includePersonal) {
              givenName: firstName
              familyName: lastName
              profilePicture: avatar
              biography: bio @skip(if: $showPrivate)
              currentLocation: location @include(if: $showPrivate)
              personalWebsite: website
            }
            userPreferences: settings {
              colorTheme: theme
              alertSettings: notifications @include(if: $showPrivate) {
                emailAlerts: email
                pushAlerts: push @skip(if: $showPrivate)
                textAlerts: sms
              }
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(complexSchema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      compiled.query({}, undefined, {
        includePersonal: true,
        showPrivate: false
      });

      // Test user resolver field availability with aliases - uses real field names, not aliases
      expect(userResolverInfo!.fieldAvailability.get("id")).toBe(true); // real field name for "userId" alias
      expect(userResolverInfo!.fieldAvailability.get("username")).toBe(true); // real field name for "displayName" alias
      expect(userResolverInfo!.fieldAvailability.get("email")).toBe(false); // real field name for "contactEmail" alias
      expect(userResolverInfo!.fieldAvailability.get("profile")).toBe(true); // real field name for "personalInfo" alias
      expect(userResolverInfo!.fieldAvailability.get("settings")).toBe(true); // real field name for "userPreferences" alias

      expect(userResolverInfo!.isFieldRequested("id")).toBe(true); // check real field name
      expect(userResolverInfo!.isFieldRequested("email")).toBe(false); // check real field name
      expect(userResolverInfo!.isFieldRequested("profile")).toBe(true); // check real field name

      // Test notifications resolver - when showPrivate is false, alertSettings is not included
      // So notificationsResolverInfo should be null since that resolver won't be called
      expect(notificationsResolverInfo).toBe(null);

      // Test settings resolver field availability - uses real field names, not aliases
      expect(settingsResolverInfo!.fieldAvailability.get("theme")).toBe(true); // real field name for "colorTheme" alias
      expect(settingsResolverInfo!.fieldAvailability.get("notifications")).toBe(false); // real field name for "alertSettings" alias, not included when showPrivate is false
    });

    test("query with union types and conditional fragments", () => {
      const query = `
        query SearchQuery($includeUserDetails: Boolean!, $includePostDetails: Boolean!) {
          search(query: "test") {
            ... on User @include(if: $includeUserDetails) {
              id
              username
              email @skip(if: $includeUserDetails)
              profile {
                firstName
                lastName
              }
            }
            ... on Post @include(if: $includePostDetails) {
              id
              title
              content @skip(if: $includeUserDetails)
              published
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(complexSchema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      // Test with includeUserDetails: true, includePostDetails: false
      compiled.query({}, undefined, {
        includeUserDetails: true,
        includePostDetails: false
      });

      // The search resolver should receive field availability info
      expect(resolverInfo).toBeTruthy();
      expect(resolverInfo!.fieldAvailability).toBeDefined();

      // NOTE: Fragment support is not yet implemented in GraphQL JIT field availability
      // As documented in resolve-info-enhanced.ts: "Fragments are not supported yet"
      // The field availability map is empty when fragments are used
      expect(resolverInfo!.fieldAvailability.size).toBe(0);
      expect(Array.from(resolverInfo!.fieldAvailability.entries())).toEqual([]);

      // Test isFieldRequested method - should return true for all fields when fragments are not supported
      // This is the correct fallback behavior: if we can't determine availability, assume the field is requested
      expect(resolverInfo!.isFieldRequested("id")).toBe(true);
      expect(resolverInfo!.isFieldRequested("username")).toBe(true);
      expect(resolverInfo!.isFieldRequested("email")).toBe(true);
      expect(resolverInfo!.isFieldRequested("profile")).toBe(true);
      expect(resolverInfo!.isFieldRequested("title")).toBe(true);
      expect(resolverInfo!.isFieldRequested("content")).toBe(true);
      expect(resolverInfo!.isFieldRequested("published")).toBe(true);

      // Test with different variable combinations - should still result in empty field availability
      compiled.query({}, undefined, {
        includeUserDetails: false,
        includePostDetails: true
      });

      expect(resolverInfo!.fieldAvailability.size).toBe(0);
      expect(resolverInfo!.isFieldRequested("title")).toBe(true); // should default to true
      expect(resolverInfo!.isFieldRequested("content")).toBe(true); // should default to true

      compiled.query({}, undefined, {
        includeUserDetails: true,
        includePostDetails: true
      });

      expect(resolverInfo!.fieldAvailability.size).toBe(0);
      expect(resolverInfo!.isFieldRequested("username")).toBe(true); // should default to true
      expect(resolverInfo!.isFieldRequested("title")).toBe(true); // should default to true

      // TODO: When fragment support is implemented, these tests should be updated to verify:
      // 1. Fragment fields are properly included in field availability based on @include/@skip directives
      // 2. Union type resolution works correctly with conditional fragments
      // 3. Nested fields within fragments are tracked accurately
      // 4. Field name collisions across different union member types are handled correctly
    });

    test("query with list fields and nested conditionals", () => {
      const query = `
        query ListQuery($includePosts: Boolean!, $includeComments: Boolean!, $showAuthor: Boolean!) {
          user(id: "1") {
            id
            username
            posts @include(if: $includePosts) {
              id
              title
              content @skip(if: $showAuthor)
              published
              comments @include(if: $includeComments) {
                id
                content
                author @include(if: $showAuthor) {
                  id
                  username
                }
              }
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(complexSchema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      compiled.query({}, undefined, {
        includePosts: true,
        includeComments: false,
        showAuthor: true
      });

      // Test user resolver field availability - only sees immediate children of User type
      expect(userResolverInfo!.fieldAvailability.get("id")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("username")).toBe(true);
      expect(userResolverInfo!.fieldAvailability.get("posts")).toBe(true);

      // User resolver should NOT see fields from nested types (Post, Comment)
      expect(userResolverInfo!.fieldAvailability.has("title")).toBe(false); // Post field
      expect(userResolverInfo!.fieldAvailability.has("content")).toBe(false); // Post field
      expect(userResolverInfo!.fieldAvailability.has("published")).toBe(false); // Post field
      expect(userResolverInfo!.fieldAvailability.has("comments")).toBe(false); // Post field
      expect(userResolverInfo!.fieldAvailability.has("author")).toBe(false); // Comment field

      // Test the isFieldRequested helper method - parent-child separation means no field collisions
      expect(userResolverInfo!.isFieldRequested("id")).toBe(true); // User.id only
      expect(userResolverInfo!.isFieldRequested("username")).toBe(true); // User.username only
      expect(userResolverInfo!.isFieldRequested("posts")).toBe(true); // User.posts

      // Fields that don't exist in User type should return false
      expect(userResolverInfo!.isFieldRequested("title")).toBe(false); // Post field, not in User
      expect(userResolverInfo!.isFieldRequested("content")).toBe(false); // Post field, not in User
    });
  });
});
