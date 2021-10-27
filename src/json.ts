/**
 * Mapping between GQL primitive types and JSON Schema property types
 *
 * @type       {<type>}
 */
import {
  FieldNode,
  getOperationRootType,
  GraphQLType,
  isAbstractType,
  isEnumType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType
} from "graphql";
import { JSONSchema6, JSONSchema6TypeName } from "json-schema";
import { collectFields, collectSubfields, resolveFieldDef } from "./ast";
import { CompilationContext } from "./execution";

const PRIMITIVES: { [key: string]: JSONSchema6TypeName } = {
  Int: "integer",
  Float: "number",
  String: "string",
  Boolean: "boolean",
  ID: "string"
};

/**
 * GQL -> JSON Schema transform
 *
 * @param compilationContext
 * @return     {object}  A plain JavaScript object which conforms to JSON Schema
 */
export function queryToJSONSchema(
  compilationContext: CompilationContext
): JSONSchema6 {
  const type = getOperationRootType(
    compilationContext.schema,
    compilationContext.operation
  );
  const fields = collectFields(
    compilationContext,
    type,
    compilationContext.operation.selectionSet,
    Object.create(null),
    Object.create(null)
  );
  const fieldProperties = Object.create(null);
  for (const responseName of Object.keys(fields)) {
    const fieldType = resolveFieldDef(
      compilationContext,
      type,
      fields[responseName]
    );
    if (!fieldType) {
      // if field does not exist, it should be ignored for compatibility concerns.
      // Usually, validation would stop it before getting here but this could be an old query
      continue;
    }
    fieldProperties[responseName] = transformNode(
      compilationContext,
      fields[responseName],
      fieldType.type
    );
  }
  return {
    type: "object",
    properties: {
      data: {
        type: ["object", "null"],
        properties: fieldProperties
      },
      errors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            message: {
              type: "string"
            },
            path: {
              type: "array",
              items: {
                type: ["string", "number"]
              }
            },
            locations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  line: {
                    type: "number"
                  },
                  column: {
                    type: "number"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function transformNode(
  compilationContext: CompilationContext,
  fieldNodes: FieldNode[],
  type: GraphQLType
): JSONSchema6 {
  if (isObjectType(type)) {
    const subfields = collectSubfields(compilationContext, type, fieldNodes);
    const properties = Object.create(null);
    for (const responseName of Object.keys(subfields)) {
      const fieldType = resolveFieldDef(
        compilationContext,
        type,
        subfields[responseName]
      );
      if (!fieldType) {
        // if field does not exist, it should be ignored for compatibility concerns.
        // Usually, validation would stop it before getting here but this could be an old query
        continue;
      }
      properties[responseName] = transformNode(
        compilationContext,
        subfields[responseName],
        fieldType.type
      );
    }
    return {
      type: ["object", "null"],
      properties
    };
  }
  if (isListType(type)) {
    return {
      type: ["array", "null"],
      items: transformNode(compilationContext, fieldNodes, type.ofType)
    };
  }
  if (isNonNullType(type)) {
    const nullable = transformNode(compilationContext, fieldNodes, type.ofType);
    if (nullable.type && Array.isArray(nullable.type)) {
      const nonNullable = nullable.type.filter((x) => x !== "null");
      return {
        ...nullable,
        type: nonNullable.length === 1 ? nonNullable[0] : nonNullable
      };
    }
    return {};
  }
  if (isEnumType(type)) {
    return {
      type: ["string", "null"]
    };
  }
  if (isScalarType(type)) {
    const jsonSchemaType = PRIMITIVES[type.name];
    if (!jsonSchemaType) {
      return {};
    }
    return {
      type: [jsonSchemaType, "null"]
    };
  }
  if (isAbstractType(type)) {
    return compilationContext.schema.getPossibleTypes(type).reduce(
      (res, t) => {
        const jsonSchema = transformNode(compilationContext, fieldNodes, t);
        res.properties = { ...res.properties, ...jsonSchema.properties };
        return res;
      },
      {
        type: ["object", "null"],
        properties: {}
      } as JSONSchema6
    );
  }
  throw new Error(`Got unhandled type: ${type.name}`);
}
