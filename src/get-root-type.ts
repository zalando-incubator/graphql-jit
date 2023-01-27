import { CompilationContext } from "./execution";
import { versionInfo } from "graphql";
import * as utilities from "graphql/utilities";
import { GraphQLObjectType } from "graphql/type/definition";

export const getRootType = (
  compilationContext: CompilationContext
): GraphQLObjectType => {
  if (versionInfo.major < 16) {
    return (utilities as any).getOperationRootType(
      compilationContext.schema,
      compilationContext.operation
    );
  }

  const type = (compilationContext.schema as any).getRootType(
    compilationContext.operation.operation
  );

  if (!type) {
    throw new Error(
      `No root type for operation ${compilationContext.operation.operation}`
    );
  }

  return type;
};
