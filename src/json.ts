/**
 * Mapping between GQL primitive types and JSON Schema property types
 *
 * @type       {<type>}
 */
import {
  FieldNode,
  GraphQLType,
  isAbstractType,
  isEnumType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType
} from "graphql";
import {
  BooleanSchema,
  IntegerSchema,
  NumberSchema,
  ObjectSchema,
  RefSchema,
  Schema,
  StringSchema
} from "fast-json-stringify";
import { collectFields, collectSubfields, resolveFieldDef } from "./ast";
import { getOperationRootType } from "./compat";
import { CompilationContext } from "./execution";

const PRIMITIVES: {
  [key: string]:
    | IntegerSchema["type"]
    | NumberSchema["type"]
    | StringSchema["type"]
    | BooleanSchema["type"];
} = {
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
): Schema {
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
        type: "object",
        properties: fieldProperties,
        nullable: true
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
): Schema {
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
      type: "object",
      properties,
      nullable: true
    };
  }
  if (isListType(type)) {
    return {
      type: "array",
      items: transformNode(compilationContext, fieldNodes, type.ofType),
      nullable: true
    };
  }
  if (isNonNullType(type)) {
    const nullable = transformNode(compilationContext, fieldNodes, type.ofType);
    (nullable as Exclude<Schema, RefSchema>).nullable = false;
    return nullable;
  }
  if (isEnumType(type)) {
    return {
      type: "string",
      nullable: true
    };
  }
  if (isScalarType(type)) {
    const jsonSchemaType = PRIMITIVES[type.name];
    if (!jsonSchemaType) {
      return {} as Schema;
    }
    return {
      type: jsonSchemaType,
      nullable: true
    };
  }
  if (isAbstractType(type)) {
    return compilationContext.schema.getPossibleTypes(type).reduce(
      (res, t) => {
        const jsonSchema = transformNode(compilationContext, fieldNodes, t);
        (res as ObjectSchema).properties = {
          ...(res as ObjectSchema).properties,
          ...(jsonSchema as ObjectSchema).properties
        };
        return res;
      },
      {
        type: "object",
        properties: {},
        nullable: true
      } as Schema
    );
  }
  throw new Error(`Got unhandled type: ${type.name}`);
}
