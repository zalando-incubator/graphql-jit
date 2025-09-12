import { makeExecutableSchema } from "@graphql-tools/schema";
import { parse } from "graphql";
import { isCompiledQuery } from "../execution";
import { compileQuery } from "../index";
import { type GraphQLJitResolveInfoWithAvailability } from "../resolve-info-enhanced";

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

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['name', true],
        ['email', false]
      ]));
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

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['name', true],
        ['email', true]
      ]));
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

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['name', true],
        ['email', true]
      ]));
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

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['name', true],
        ['email', false]
      ]));
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

      expect(resolverInfo!.fieldAvailability.get('email')).toBe(false);
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

      expect(resolverInfo!.fieldAvailability.get('email')).toBe(true);
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

      expect(resolverInfo!.fieldAvailability.get('email')).toBe(true);
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

      expect(resolverInfo!.fieldAvailability.get('email')).toBe(false);
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

      expect(resolverInfo!.fieldAvailability.get('email')).toBe(true);
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

      expect(resolverInfo!.fieldAvailability.get('email')).toBe(false);
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

      expect(resolverInfo!.fieldAvailability.get('email')).toBe(false);
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

      expect(resolverInfo!.fieldAvailability.get('email')).toBe(false);
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

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['name', true],
        ['email', false],
        ['phone', false],
        ['profile', false],
        ['bio', false]
      ]));
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
      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['bio', false],
        ['avatar', true]
      ]));
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

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['fullName', true],
        ['userEmail', false]
      ]));
      expect(resolverInfo!.isFieldRequested("userEmail")).toBe(false);
      expect(resolverInfo!.isFieldRequested("fullName")).toBe(true);
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

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['title', true],
        ['content', false]
      ]));
      expect(resolverInfo!.isFieldRequested("content")).toBe(false);
    });
  });

  // Skipping tests that rely on fragments. Fragments are not supported yet
  describe.skip("Fragments - Field Availability", () => {
    let resolverInfo: GraphQLJitResolveInfoWithAvailability | null = null;

    beforeEach(() => {
      resolverInfo = null;
    });

    const createMockResolver = (name: string) =>
      jest.fn(
        (
          parent: any,
          args: any,
          context: any,
          info: GraphQLJitResolveInfoWithAvailability
        ) => {
          resolverInfo = info;

          const result: any = { id: `${name}-123` };
          if (info.isFieldRequested("id")) result.id = `${name}-id`;
          if (info.isFieldRequested("name")) result.name = `${name}-name`;
          if (info.isFieldRequested("email")) result.email = `${name}@test.com`;
          if (info.isFieldRequested("phone")) result.phone = `${name}-phone`;
          if (info.isFieldRequested("profile"))
            result.profile = { bio: `${name}-bio`, avatar: `${name}-avatar` };
          if (info.isFieldRequested("posts"))
            result.posts = [
              { title: `${name}-title`, content: `${name}-content` }
            ];
          return result;
        }
      );

    test("Named fragment spread (unconditional)", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        fragment UserCore on User {
          id
          name
        }

        query Test {
          user {
            ...UserCore
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      const result = compiled.query({}, undefined, {});

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['name', true]
      ]));
    });

    test("Fragment spread with @include on spread (variable-controlled)", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, email: String, phone: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        fragment UserContact on User {
          email
          phone
        }

        query Test($withContact: Boolean!) {
          user {
            id
            ...UserContact @include(if: $withContact)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      compiled.query({}, undefined, { withContact: true });
      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['email', true],
        ['phone', true]
      ]));

      compiled.query({}, undefined, { withContact: false });
      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['email', false],
        ['phone', false]
      ]));
    });

    test("Directives inside fragment fields (variable-controlled)", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, email: String, phone: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        fragment UserDetails on User {
          email @skip(if: $skipEmail)
          phone
        }

        query Test($skipEmail: Boolean!) {
          user {
            id
            ...UserDetails
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      compiled.query({}, undefined, { skipEmail: true });
      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['email', false],
        ['phone', true]
      ]));

      compiled.query({}, undefined, { skipEmail: false });
      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['email', true],
        ['phone', true]
      ]));
    });

    test("Merging overlapping fields from multiple fragments (OR semantics)", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        fragment A on User { email  }
        fragment B on User { email @include(if: $incB) }

        query Test($incA: Boolean!, $incB: Boolean!) {
          user {
            ...A @include(if: $incA)
            ...B
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      compiled.query({}, undefined, { incA: false, incB: true });
      expect(resolverInfo!.fieldAvailability).toEqual(new Map([['email', true]]));

      compiled.query({}, undefined, { incA: true, incB: false });
      expect(resolverInfo!.fieldAvailability).toEqual(new Map([['email', true]]));

      compiled.query({}, undefined, { incA: false, incB: false });
      expect(resolverInfo!.fieldAvailability).toEqual(new Map([['email', false]]));
    });

    test("Inline fragment (unconditional)", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test {
          user {
            ... on User {
              name
              email
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      compiled.query({}, undefined, {});

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['name', true],
        ['email', true]
      ]));
    });

    test("Inline fragment with directive on fragment (skip entire block)", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { email: String, phone: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query Test($showInfo: Boolean!) {
          user {
            ... on User @include(if: $showInfo) {
              email
              phone
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      compiled.query({}, undefined, { showInfo: true });
      expect(resolverInfo!.fieldAvailability).toEqual({
        email: true,
        phone: true
      });

      compiled.query({}, undefined, { showInfo: false });
      expect(resolverInfo!.fieldAvailability).toEqual({
        email: false,
        phone: false
      });
    });

    test("Nested fragments within nested object resolver", () => {
      let profileInfo: GraphQLJitResolveInfoWithAvailability | null = null;

      const userResolver = createMockResolver("user");
      const profileResolver = jest.fn(
        (
          parent: any,
          args: any,
          context: any,
          info: GraphQLJitResolveInfoWithAvailability
        ) => {
          profileInfo = info;
          return {
            bio: info.isFieldRequested("bio") ? "bio" : undefined,
            avatar: info.isFieldRequested("avatar") ? "avatar" : undefined
          };
        }
      );

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, profile: Profile }
          type Profile { bio: String, avatar: String }
        `,
        resolvers: {
          Query: { user: userResolver },
          User: { profile: profileResolver }
        }
      });

      const query = `
        fragment ProfileFields on Profile {
          bio
          avatar
        }

        fragment UserWithProfile on User {
          id
          profile { ...ProfileFields }
        }

        query Test {
          user { ...UserWithProfile }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      compiled.query({}, undefined, {});

      // Top-level user resolver sees id and profile requested
      expect(resolverInfo!.fieldAvailability).toEqual({
        id: true,
        profile: true
      });

      // Nested resolver sees its own selection set availability
      expect(profileInfo!.fieldAvailability).toEqual(new Map([
        ['bio', true],
        ['avatar', true]
      ]));
    });

    test("Alias fields inside named fragment", () => {
      const resolver = createMockResolver("user");

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        fragment AliasFrag on User {
          fullName: name
          userEmail: email
        }

        query Test {
          user { ...AliasFrag }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });
      compiled.query({}, undefined, {});

      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['fullName', true],
        ['userEmail', true]
      ]));
      expect(resolverInfo!.isFieldRequested("fullName")).toBe(true);
      expect(resolverInfo!.isFieldRequested("userEmail")).toBe(true);
    });

    // fails
    test("Fragment spread inside inline fragment with directive", () => {
      const resolver = createMockResolver("user");

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, name: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        fragment Core on User { id name }

        query Test($show: Boolean!) {
          user {
            ... on User @include(if: $show) {
              ...Core
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      compiled.query({}, undefined, { show: true });
      expect(resolverInfo!.fieldAvailability).toEqual(new Map([
        ['id', true],
        ['name', true]
      ]));

      compiled.query({}, undefined, { show: false });
      expect(resolverInfo!.fieldAvailability).toEqual({
        id: false,
        name: false
      });
    });

    test("Directives both on fragment spread and inside fragment fields", () => {
      const resolver = createMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { email: String, phone: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        fragment Details on User {
          email @skip(if: $skipEmail)
          phone
        }

        query Test($withDetails: Boolean!, $skipEmail: Boolean!) {
          user {
            ...Details @include(if: $withDetails)
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      // withDetails true, skipEmail true
      compiled.query({}, undefined, { withDetails: true, skipEmail: true });
      expect(resolverInfo!.fieldAvailability).toEqual({
        email: false,
        phone: true
      });

      // withDetails false, fields excluded entirely
      compiled.query({}, undefined, { withDetails: false, skipEmail: true });
      expect(resolverInfo!.fieldAvailability).toEqual({
        email: false,
        phone: false
      });
    });

    test("Fragment on list item type (nested list resolver)", () => {
      let postsInfo: GraphQLJitResolveInfoWithAvailability | null = null;

      const userResolver = createMockResolver("user");
      const postsResolver = jest.fn(
        (
          parent: any,
          args: any,
          context: any,
          info: GraphQLJitResolveInfoWithAvailability
        ) => {
          postsInfo = info;
          return [
            {
              title: info.isFieldRequested("title") ? "T1" : undefined,
              content: info.isFieldRequested("content") ? "C1" : undefined
            }
          ];
        }
      );

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { posts: [Post] }
          type Post { title: String, content: String }
        `,
        resolvers: {
          Query: { user: userResolver },
          User: { posts: postsResolver }
        }
      });

      const query = `
        fragment PostFields on Post {
          title
          content @skip(if: $skipContent)
        }

        query Test($skipContent: Boolean!) {
          user {
            posts { ...PostFields }
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      compiled.query({}, undefined, { skipContent: true });
      expect(postsInfo!.fieldAvailability).toEqual(new Map([
        ['title', true],
        ['content', false]
      ]));

      compiled.query({}, undefined, { skipContent: false });
      expect(postsInfo!.fieldAvailability).toEqual(new Map([
        ['title', true],
        ['content', true]
      ]));
    });

    test("Multiple spreads with overlapping fields and aliases merge correctly", () => {
      const resolver = createMockResolver("user");

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { name: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        fragment A on User { name userEmail: email @include(if: $a) }
        fragment B on User { fullName: name @include(if: $b) email @include(if: $b) }

        query Test($a: Boolean!, $b: Boolean!) {
          user {
            ...A
            ...B
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      // a=false, b=true
      compiled.query({}, undefined, { a: false, b: true });
      expect(resolverInfo!.fieldAvailability).toEqual({
        name: true,
        fullName: true,
        email: true,
        userEmail: false
      });

      // a=true, b=false
      compiled.query({}, undefined, { a: true, b: false });
      expect(resolverInfo!.fieldAvailability).toEqual({
        name: true,
        fullName: false,
        email: false,
        userEmail: true
      });

      // a=true, b=true -> all true, but alias keys maintained separately
      compiled.query({}, undefined, { a: true, b: true });
      expect(resolverInfo!.fieldAvailability).toEqual({
        name: true,
        fullName: true,
        email: true,
        userEmail: true
      });
    });

    test("Optional variables on fragment directives default to false/true semantics", () => {
      const resolver = createMockResolver("user");

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User { id: String, email: String }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        fragment F on User { email @skip(if: $skipEmail) }

        query Test($skipEmail: Boolean) {
          user {
            id
            ...F
          }
        }
      `;

      const ast = parse(query);
      const compiled: any = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) return;

      compiled.query({}, undefined, {}); // no variable: skipEmail undefined -> skip=false
      expect(resolverInfo!.fieldAvailability).toEqual({
        id: true,
        email: true
      });
    });
  });
});
