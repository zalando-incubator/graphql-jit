import { GraphQLError, versionInfo } from "graphql";
import * as utilities from "graphql/error";
import { GraphQLFormattedError } from "graphql/error";

export const formatError = (error: GraphQLError): GraphQLFormattedError => {
  if (versionInfo.major < 16) {
    return (utilities as any).formatError(error);
  }

  return (error as any).toJSON();
};
