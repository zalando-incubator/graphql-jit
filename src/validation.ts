import { GraphQLError } from "graphql";

const NAME_RX = /^[_A-Za-z][_0-9A-Za-z]*$/;

/**
 * Asserts that a name from the document is a valid GraphQL name.
 *
 * The parser guarantees names match [_A-Za-z][_0-9A-Za-z]*, but a
 * DocumentNode can also be constructed by hand, so they are checked here.
 *
 * @param name The name to check
 * @param context What the name is used for (for error messages)
 * @throws GraphQLError if the name is not valid
 */
export function assertValidName(name: string, context: string): void {
  if (typeof name !== "string" || !NAME_RX.test(name)) {
    throw new GraphQLError(
      `Invalid ${context}: ${JSON.stringify(name)}. ` +
        `Names must match ${NAME_RX}.`
    );
  }
}
