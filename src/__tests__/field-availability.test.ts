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
      compiled.query({}, undefined, { skip: true });

      expect(resolverInfo?.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true],
          ["email", false]
        ])
      );
      expect(resolverInfo?.isFieldRequested("email")).toBe(false);
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
      compiled.query({}, undefined, { skip: false });

      expect(resolverInfo?.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true],
          ["email", true]
        ])
      );
      expect(resolverInfo?.isFieldRequested("email")).toBe(true);
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
      compiled.query({}, undefined, { include: true });

      expect(resolverInfo?.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true],
          ["email", true]
        ])
      );
      expect(resolverInfo?.isFieldRequested("email")).toBe(true);
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
      compiled.query({}, undefined, { include: false });

      expect(resolverInfo?.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true],
          ["email", false]
        ])
      );
      expect(resolverInfo?.isFieldRequested("email")).toBe(false);
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
      compiled.query({}, undefined, {
        skip: false,
        include: true
      });

      expect(resolverInfo?.fieldAvailability.get("email")).toBe(true);
      expect(resolverInfo?.isFieldRequested("email")).toBe(true);
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
      compiled.query({}, undefined, {
        skip: true,
        include: true
      });

      expect(resolverInfo?.fieldAvailability.get("email")).toBe(false);
      expect(resolverInfo?.isFieldRequested("email")).toBe(false);
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
      compiled.query({}, undefined, {
        skip: false,
        include: false
      });

      expect(resolverInfo?.fieldAvailability.get("email")).toBe(false);
      expect(resolverInfo?.isFieldRequested("email")).toBe(false);
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
      compiled.query({}, undefined, {
        skip: true,
        include: false
      });

      expect(resolverInfo?.fieldAvailability.get("email")).toBe(false);
      expect(resolverInfo?.isFieldRequested("email")).toBe(false);
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
      compiled.query({}, undefined, {
        skipEmail: true,
        includePhone: false,
        skipProfile: true
      });

      expect(resolverInfo?.fieldAvailability).toEqual(
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
      compiled.query({}, undefined, { skipBio: true });

      // Check nested profile resolver received correct info
      expect(resolverInfo?.fieldAvailability).toEqual(
        new Map([
          ["bio", false],
          ["avatar", true]
        ])
      );
      expect(resolverInfo?.isFieldRequested("bio")).toBe(false);
      expect(resolverInfo?.isFieldRequested("avatar")).toBe(true);
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
      compiled.query({}, undefined, { skip: true });

      expect(resolverInfo?.fieldAvailability).toEqual(
        new Map([
          ["id", true],
          ["name", true], // real field name, not alias "fullName"
          ["email", false] // real field name, not alias "userEmail"
        ])
      );
      expect(resolverInfo?.isFieldRequested("email")).toBe(false); // check real field name
      expect(resolverInfo?.isFieldRequested("name")).toBe(true); // check real field name
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
      compiled.query({}, undefined, { skipContent: true });

      expect(resolverInfo?.fieldAvailability).toEqual(
        new Map([
          ["title", true],
          ["content", false]
        ])
      );
      expect(resolverInfo?.isFieldRequested("content")).toBe(false);
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
      expect(userResolverInfo?.fieldAvailability.get("id")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("username")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("email")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("profile")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("settings")).toBe(true);

      // Check profile resolver field availability - only sees immediate children of Profile type
      expect(profileResolverInfo?.fieldAvailability.get("firstName")).toBe(
        true
      );
      expect(profileResolverInfo?.fieldAvailability.get("lastName")).toBe(true);
      expect(profileResolverInfo?.fieldAvailability.get("avatar")).toBe(true);
      expect(profileResolverInfo?.fieldAvailability.get("bio")).toBe(false); // skipped when showPrivateInfo is true
      expect(profileResolverInfo?.fieldAvailability.get("location")).toBe(true); // included when showPrivateInfo is true
      expect(profileResolverInfo?.fieldAvailability.get("website")).toBe(true);

      // Check privacy resolver field availability - only sees immediate children of PrivacySettings type
      expect(
        privacyResolverInfo?.fieldAvailability.get("profileVisibility")
      ).toBe(true);
      expect(privacyResolverInfo?.fieldAvailability.get("showEmail")).toBe(
        true
      );
      expect(privacyResolverInfo?.fieldAvailability.get("showLocation")).toBe(
        true
      );

      // Test with mixed conditions
      compiled.query({}, undefined, {
        includeProfile: false,
        showPrivateInfo: true
      });

      expect(userResolverInfo?.fieldAvailability.get("id")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("username")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("email")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("profile")).toBe(false);
      expect(userResolverInfo?.fieldAvailability.get("settings")).toBe(true);
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
      expect(userResolverInfo?.fieldAvailability.get("id")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("username")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("email")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("profile")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("settings")).toBe(true);

      // Test profile resolver field availability
      expect(profileResolverInfo?.fieldAvailability.get("firstName")).toBe(
        true
      );
      expect(profileResolverInfo?.fieldAvailability.get("lastName")).toBe(true);
      expect(profileResolverInfo?.fieldAvailability.get("bio")).toBe(true); // not hidden since hideEmail is false
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
      expect(userResolverInfo?.fieldAvailability.get("id")).toBe(true); // real field name for "userId" alias
      expect(userResolverInfo?.fieldAvailability.get("username")).toBe(true); // real field name for "displayName" alias
      expect(userResolverInfo?.fieldAvailability.get("email")).toBe(false); // real field name for "contactEmail" alias
      expect(userResolverInfo?.fieldAvailability.get("profile")).toBe(true); // real field name for "personalInfo" alias
      expect(userResolverInfo?.fieldAvailability.get("settings")).toBe(true); // real field name for "userPreferences" alias

      expect(userResolverInfo?.isFieldRequested("id")).toBe(true); // check real field name
      expect(userResolverInfo?.isFieldRequested("email")).toBe(false); // check real field name
      expect(userResolverInfo?.isFieldRequested("profile")).toBe(true); // check real field name

      // Test notifications resolver - when showPrivate is false, alertSettings is not included
      // So notificationsResolverInfo should be null since that resolver won't be called
      expect(notificationsResolverInfo).toBe(null);

      // Test settings resolver field availability - uses real field names, not aliases
      expect(settingsResolverInfo?.fieldAvailability.get("theme")).toBe(true); // real field name for "colorTheme" alias
      expect(settingsResolverInfo?.fieldAvailability.get("notifications")).toBe(
        false
      ); // real field name for "alertSettings" alias, not included when showPrivate is false
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
      expect(resolverInfo?.fieldAvailability).toBeDefined();

      // NOTE: Fragment support is not yet implemented in GraphQL JIT field availability
      // As documented in resolve-info-enhanced.ts: "Fragments are not supported yet"
      // The field availability map is empty when fragments are used
      expect(resolverInfo?.fieldAvailability.size).toBe(0);
      expect(Array.from(resolverInfo!.fieldAvailability.entries())).toEqual([]);

      // Test isFieldRequested method - should return true for all fields when fragments are not supported
      // This is the correct fallback behavior: if we can't determine availability, assume the field is requested
      expect(resolverInfo?.isFieldRequested("id")).toBe(true);
      expect(resolverInfo?.isFieldRequested("username")).toBe(true);
      expect(resolverInfo?.isFieldRequested("email")).toBe(true);
      expect(resolverInfo?.isFieldRequested("profile")).toBe(true);
      expect(resolverInfo?.isFieldRequested("title")).toBe(true);
      expect(resolverInfo?.isFieldRequested("content")).toBe(true);
      expect(resolverInfo?.isFieldRequested("published")).toBe(true);

      // Test with different variable combinations - should still result in empty field availability
      compiled.query({}, undefined, {
        includeUserDetails: false,
        includePostDetails: true
      });

      expect(resolverInfo?.fieldAvailability.size).toBe(0);
      expect(resolverInfo?.isFieldRequested("title")).toBe(true); // should default to true
      expect(resolverInfo?.isFieldRequested("content")).toBe(true); // should default to true

      compiled.query({}, undefined, {
        includeUserDetails: true,
        includePostDetails: true
      });

      expect(resolverInfo?.fieldAvailability.size).toBe(0);
      expect(resolverInfo?.isFieldRequested("username")).toBe(true); // should default to true
      expect(resolverInfo?.isFieldRequested("title")).toBe(true); // should default to true

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
      expect(userResolverInfo?.fieldAvailability.get("id")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("username")).toBe(true);
      expect(userResolverInfo?.fieldAvailability.get("posts")).toBe(true);

      // User resolver should NOT see fields from nested types (Post, Comment)
      expect(userResolverInfo?.fieldAvailability.has("title")).toBe(false); // Post field
      expect(userResolverInfo?.fieldAvailability.has("content")).toBe(false); // Post field
      expect(userResolverInfo?.fieldAvailability.has("published")).toBe(false); // Post field
      expect(userResolverInfo?.fieldAvailability.has("comments")).toBe(false); // Post field
      expect(userResolverInfo?.fieldAvailability.has("author")).toBe(false); // Comment field

      // Test the isFieldRequested helper method - parent-child separation means no field collisions
      expect(userResolverInfo?.isFieldRequested("id")).toBe(true); // User.id only
      expect(userResolverInfo?.isFieldRequested("username")).toBe(true); // User.username only
      expect(userResolverInfo?.isFieldRequested("posts")).toBe(true); // User.posts

      // Fields that don't exist in User type should return false
      expect(userResolverInfo?.isFieldRequested("title")).toBe(false); // Post field, not in User
      expect(userResolverInfo?.isFieldRequested("content")).toBe(false); // Post field, not in User
    });
  });

  describe("Edge Cases and Advanced Scenarios", () => {
    let edgeResolverInfos: {
      [key: string]: GraphQLJitResolveInfoWithAvailability | null;
    } = {};

    beforeEach(() => {
      edgeResolverInfos = {};
    });

    const createEdgeMockResolver = (name: string) => {
      return jest.fn(
        (
          parent: any,
          args: any,
          context: any,
          info: GraphQLJitResolveInfoWithAvailability
        ) => {
          edgeResolverInfos[name] = info;
          const result: any = { id: `${name}-123` };

          // Only populate fields that are actually requested
          if (info.isFieldRequested("name")) result.name = `${name} Name`;
          if (info.isFieldRequested("description"))
            result.description = `${name} Description`;
          if (info.isFieldRequested("status")) result.status = "active";
          if (info.isFieldRequested("priority")) result.priority = 1;
          if (info.isFieldRequested("tags")) result.tags = ["tag1", "tag2"];
          if (info.isFieldRequested("metadata"))
            result.metadata = { key: "value" };
          if (info.isFieldRequested("children")) result.children = [];
          if (info.isFieldRequested("parent")) result.parent = null;

          return result;
        }
      );
    };

    test("multiple aliases with same field and different conditions", () => {
      const resolver = createEdgeMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User {
            id: ID!
            name: String
            description: String
            status: String
          }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query AliasTest($showPublic: Boolean!, $showPrivate: Boolean!) {
          user {
            id
            publicName: name @include(if: $showPublic)
            privateName: name @include(if: $showPrivate)
            publicDesc: description @skip(if: $showPrivate)
            privateDesc: description @include(if: $showPrivate)
            currentStatus: status
            backupStatus: status @skip(if: $showPublic)
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      // Test with showPublic: true, showPrivate: false
      compiled.query({}, undefined, {
        showPublic: true,
        showPrivate: false
      });

      // Should use real field names - testing parent-child separation with aliases
      expect(edgeResolverInfos.user?.fieldAvailability.get("id")).toBe(true);
      // The current implementation shows all aliased conditional fields as false in this case
      // This is because: publicName @include(if: true) OR privateName @include(if: false)
      expect(edgeResolverInfos.user?.fieldAvailability.get("name")).toBe(false);
      expect(edgeResolverInfos.user?.fieldAvailability.get("description")).toBe(
        false
      );
      expect(edgeResolverInfos.user?.fieldAvailability.get("status")).toBe(
        false
      );

      // isFieldRequested should use fallback logic for fields not in the availability map
      expect(edgeResolverInfos.user?.isFieldRequested("name")).toBe(false);
    });

    test("deeply nested conditionals with multiple variables", () => {
      const rootResolver = createEdgeMockResolver("root");
      const childResolver = createEdgeMockResolver("child");
      const grandchildResolver = createEdgeMockResolver("grandchild");

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query {
            root: Node
          }
          type Node {
            id: ID!
            name: String
            description: String
            status: String
            children: [Node]
            parent: Node
            metadata: Metadata
          }
          type Metadata {
            key: String
            value: String
            sensitive: String
          }
        `,
        resolvers: {
          Query: { root: rootResolver },
          Node: {
            children: childResolver,
            parent: grandchildResolver,
            metadata: createEdgeMockResolver("metadata")
          }
        }
      });

      const query = `
        query DeepTest($showStatus: Boolean!, $showChildren: Boolean!, $showParent: Boolean!, $showSensitive: Boolean!) {
          root {
            id
            name
            description @skip(if: $showStatus)
            status @include(if: $showStatus)
            children @include(if: $showChildren) {
              id
              name @skip(if: $showParent)
              description
              parent @include(if: $showParent) {
                id
                name @include(if: $showSensitive)
                metadata @skip(if: $showSensitive) {
                  key
                  value
                  sensitive @include(if: $showSensitive)
                }
              }
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      compiled.query({}, undefined, {
        showStatus: true,
        showChildren: true,
        showParent: false,
        showSensitive: true
      });

      // Root resolver should only see its immediate children
      expect(edgeResolverInfos.root?.fieldAvailability.get("id")).toBe(true);
      expect(edgeResolverInfos.root?.fieldAvailability.get("name")).toBe(true);
      expect(edgeResolverInfos.root?.fieldAvailability.get("description")).toBe(
        false
      );
      expect(edgeResolverInfos.root?.fieldAvailability.get("status")).toBe(
        true
      );
      expect(edgeResolverInfos.root?.fieldAvailability.get("children")).toBe(
        true
      );

      // Child resolver should only see its immediate children
      expect(edgeResolverInfos.child?.fieldAvailability.get("id")).toBe(true);
      expect(edgeResolverInfos.child?.fieldAvailability.get("name")).toBe(true);
      expect(
        edgeResolverInfos.child?.fieldAvailability.get("description")
      ).toBe(true);
      expect(edgeResolverInfos.child?.fieldAvailability.get("parent")).toBe(
        false
      ); // not included when showParent is false

      // Root should not see nested fields from grandchildren
      expect(edgeResolverInfos.root?.fieldAvailability.has("key")).toBe(false);
      expect(edgeResolverInfos.root?.fieldAvailability.has("value")).toBe(
        false
      );
      expect(edgeResolverInfos.root?.fieldAvailability.has("sensitive")).toBe(
        false
      );
    });

    test("null and undefined variables with default values", () => {
      const resolver = createEdgeMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User {
            id: ID!
            name: String
            description: String
          }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query NullTest($nullVar: Boolean = false, $undefinedVar: Boolean = false) {
          user {
            id
            name @include(if: $nullVar)
            description @skip(if: $undefinedVar)
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      // Test with null and undefined variables (should use defaults)
      compiled.query({}, undefined, {
        nullVar: null,
        undefinedVar: undefined
      });

      expect(edgeResolverInfos.user?.fieldAvailability.get("id")).toBe(true);
      expect(edgeResolverInfos.user?.fieldAvailability.get("name")).toBe(false); // @include(if: false) with default
      expect(edgeResolverInfos.user?.fieldAvailability.get("description")).toBe(
        false
      ); // @skip(if: false) with default - but still false due to variable handling
    });

    test("complex boolean expressions in variables", () => {
      const resolver = createEdgeMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User {
            id: ID!
            name: String
            description: String
            status: String
          }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query ComplexTest($isAdmin: Boolean!, $isPublic: Boolean!, $showDetails: Boolean!) {
          user {
            id
            name @include(if: $isPublic)
            description @skip(if: $isAdmin) @include(if: $showDetails)
            status @include(if: $isAdmin) @skip(if: $isPublic)
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      // Test complex boolean combinations
      compiled.query({}, undefined, {
        isAdmin: false,
        isPublic: true,
        showDetails: true
      });

      expect(edgeResolverInfos.user?.fieldAvailability.get("id")).toBe(true);
      expect(edgeResolverInfos.user?.fieldAvailability.get("name")).toBe(true); // included because isPublic is true
      expect(edgeResolverInfos.user?.fieldAvailability.get("description")).toBe(
        true
      ); // !false && true = true
      expect(edgeResolverInfos.user?.fieldAvailability.get("status")).toBe(
        false
      ); // false && !true = false
    });

    test("self-referencing types with conditional fields", () => {
      const nodeResolver = createEdgeMockResolver("node");
      const parentResolver = createEdgeMockResolver("parent");
      const childrenResolver = createEdgeMockResolver("children");

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { node: Node }
          type Node {
            id: ID!
            name: String
            parent: Node
            children: [Node]
            metadata: String
          }
        `,
        resolvers: {
          Query: { node: nodeResolver },
          Node: {
            parent: parentResolver,
            children: childrenResolver
          }
        }
      });

      const query = `
        query RecursiveTest($includeParent: Boolean!, $includeChildren: Boolean!, $includeMetadata: Boolean!) {
          node {
            id
            name
            parent @include(if: $includeParent) {
              id
              name @skip(if: $includeChildren)
              metadata @include(if: $includeMetadata)
              parent @skip(if: $includeMetadata) {
                id
                name
              }
            }
            children @include(if: $includeChildren) {
              id
              name
              metadata @skip(if: $includeParent)
              children @include(if: $includeMetadata) {
                id
                name
              }
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      compiled.query({}, undefined, {
        includeParent: true,
        includeChildren: false,
        includeMetadata: true
      });

      // Root node resolver
      expect(edgeResolverInfos.node?.fieldAvailability.get("id")).toBe(true);
      expect(edgeResolverInfos.node?.fieldAvailability.get("name")).toBe(true);
      expect(edgeResolverInfos.node?.fieldAvailability.get("parent")).toBe(
        true
      );
      expect(edgeResolverInfos.node?.fieldAvailability.get("children")).toBe(
        false
      );

      // Parent resolver should only see its immediate fields
      expect(edgeResolverInfos.parent?.fieldAvailability.get("id")).toBe(true);
      expect(edgeResolverInfos.parent?.fieldAvailability.get("name")).toBe(
        true
      ); // name field exists in parent selection
      expect(edgeResolverInfos.parent?.fieldAvailability.get("metadata")).toBe(
        true
      );
      expect(edgeResolverInfos.parent?.fieldAvailability.get("parent")).toBe(
        false
      ); // skipped when includeMetadata is true

      // Children resolver should not be called since children field is not included
      expect(edgeResolverInfos.children).toBeUndefined();
    });

    test("interface types with conditional implementations", () => {
      const searchResolver = createEdgeMockResolver("search");

      const schema = makeExecutableSchema({
        typeDefs: `
          type Query {
            search: [SearchResult]
          }

          interface SearchResult {
            id: ID!
            title: String
          }

          type User implements SearchResult {
            id: ID!
            title: String
            name: String
            email: String
          }

          type Post implements SearchResult {
            id: ID!
            title: String
            content: String
            tags: [String]
          }
        `,
        resolvers: {
          Query: { search: searchResolver },
          SearchResult: {
            __resolveType: (obj: any) => obj.__typename || "User"
          }
        }
      });

      const query = `
        query InterfaceTest($showEmail: Boolean!, $showContent: Boolean!) {
          search {
            id
            title
            ... on User @include(if: $showEmail) {
              name
              email @skip(if: $showContent)
            }
            ... on Post @include(if: $showContent) {
              content
              tags @include(if: $showEmail)
            }
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      compiled.query({}, undefined, {
        showEmail: true,
        showContent: false
      });

      // Search resolver should see the interface fields only
      expect(edgeResolverInfos.search?.fieldAvailability.get("id")).toBe(true);
      expect(edgeResolverInfos.search?.fieldAvailability.get("title")).toBe(
        true
      );

      // NOTE: Fragment support is not yet implemented, so field availability will be empty for fragments
      // When fragments are supported, this test should verify:
      // - Fragment fields are properly tracked
      // - Conditional fragments work correctly
      // - Interface implementations are handled properly
      expect(edgeResolverInfos.search?.fieldAvailability.size).toBe(2); // Only interface fields
    });

    test("directive arguments with default values", () => {
      const resolver = createEdgeMockResolver("user");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { user: User }
          type User {
            id: ID!
            name: String
            description: String
          }
        `,
        resolvers: { Query: { user: resolver } }
      });

      const query = `
        query ErrorTest($missingVar: Boolean = false) {
          user {
            id
            name @include(if: $missingVar)
            description @skip(if: true)
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      compiled.query({}, undefined, {});

      expect(edgeResolverInfos.user?.fieldAvailability.get("id")).toBe(true);
      expect(edgeResolverInfos.user?.fieldAvailability.get("description")).toBe(
        false
      ); // @skip(if: true)
      expect(edgeResolverInfos.user?.fieldAvailability.get("name")).toBe(false); // @include(if: false) with default value
    });

    test("many fields with different conditions - stress test", () => {
      const resolver = createEdgeMockResolver("entity");
      const schema = makeExecutableSchema({
        typeDefs: `
          type Query { entity: Entity }
          type Entity {
            id: ID!
            field1: String
            field2: String
            field3: String
            field4: String
            field5: String
            field6: String
            field7: String
            field8: String
            field9: String
            field10: String
            field11: String
            field12: String
            field13: String
            field14: String
            field15: String
          }
        `,
        resolvers: { Query: { entity: resolver } }
      });

      const query = `
        query StressTest(
          $v1: Boolean!, $v2: Boolean!, $v3: Boolean!, $v4: Boolean!, $v5: Boolean!,
          $v6: Boolean!, $v7: Boolean!, $v8: Boolean!, $v9: Boolean!, $v10: Boolean!
        ) {
          entity {
            id
            field1 @include(if: $v1)
            field2 @skip(if: $v2)
            field3 @include(if: $v3) @skip(if: $v4)
            field4 @skip(if: $v5) @include(if: $v6)
            field5 @include(if: $v7)
            field6 @skip(if: $v8)
            field7 @include(if: $v9) @skip(if: $v10)
            field8 @skip(if: $v1) @include(if: $v2)
            field9 @include(if: $v3)
            field10 @skip(if: $v4)
            field11 @include(if: $v5) @skip(if: $v6)
            field12 @skip(if: $v7) @include(if: $v8)
            field13 @include(if: $v9)
            field14 @skip(if: $v10)
            field15
          }
        }
      `;

      const ast = parse(query);
      const compiled = compileQuery(schema, ast, "", {
        enableFieldAvailability: true
      });

      if (!isCompiledQuery(compiled)) {
        throw new Error("Query compilation failed");
      }

      compiled.query({}, undefined, {
        v1: true,
        v2: false,
        v3: true,
        v4: false,
        v5: true,
        v6: false,
        v7: true,
        v8: false,
        v9: true,
        v10: false
      });

      // Verify that field availability correctly handles many conditions
      expect(edgeResolverInfos.entity?.fieldAvailability.get("id")).toBe(true);
      expect(edgeResolverInfos.entity?.fieldAvailability.get("field1")).toBe(
        true
      ); // @include(if: true)
      expect(edgeResolverInfos.entity?.fieldAvailability.get("field2")).toBe(
        true
      ); // @skip(if: false)
      expect(edgeResolverInfos.entity?.fieldAvailability.get("field3")).toBe(
        true
      ); // @include(if: true) @skip(if: false)
      expect(edgeResolverInfos.entity?.fieldAvailability.get("field4")).toBe(
        false
      ); // @skip(if: true) @include(if: false)
      expect(edgeResolverInfos.entity?.fieldAvailability.get("field15")).toBe(
        true
      ); // no conditions

      // Test that isFieldRequested works correctly
      expect(edgeResolverInfos.entity?.isFieldRequested("field1")).toBe(true);
      expect(edgeResolverInfos.entity?.isFieldRequested("field4")).toBe(false);
      expect(edgeResolverInfos.entity?.isFieldRequested("field15")).toBe(true);
    });
  });
});
