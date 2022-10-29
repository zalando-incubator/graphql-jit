import { CompilationContext } from "./execution";

export const getRootType = (compilationContext: CompilationContext) => {
  const type = compilationContext.schema.getRootType(
    compilationContext.operation.operation
  );

  if (!type) {
    throw new Error(
      `No root type for operation ${compilationContext.operation.operation}`
    );
  }

  return type;
};
