import { Maybe } from "graphql/jsutils/Maybe";
import { ASTNode } from "graphql/language/ast";
import { GraphQLError, versionInfo } from "graphql";

export const getGraphQLErrorOptions = (
  nodes: Maybe<ReadonlyArray<ASTNode> | ASTNode>
): ConstructorParameters<typeof GraphQLError>[1] => {
  if (versionInfo.major < 16) {
    return nodes as any;
  }

  return { nodes } as any;
};
