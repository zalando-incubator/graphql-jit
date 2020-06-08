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
import { ObjectSchema, ArraySchema, StringSchema, NumberSchema, BooleanSchema, IntegerSchema, NullSchema, Schema } from 'fast-json-stringify'
import { collectFields, ExecutionContext } from "graphql/execution/execute";
import { collectSubfields, resolveFieldDef } from "./ast";

const PRIMITIVES: { [key: string]: (StringSchema | NumberSchema | BooleanSchema | IntegerSchema)['type'] } = {
  Int: "integer",
  Float: "number",
  String: "string",
  Boolean: "boolean",
  ID: "string"
};

/**
 * GQL -> JSON Schema transform
 *
 * @param exeContext
 * @return     {object}  A plain JavaScript object which conforms to JSON Schema
 */
export function queryToJSONSchema(exeContext: ExecutionContext): ObjectSchema {
  const type = getOperationRootType(exeContext.schema, exeContext.operation);
  const fields = collectFields(
    exeContext,
    type,
    exeContext.operation.selectionSet,
    Object.create(null),
    Object.create(null)
  );
  const fieldProperties = Object.create(null);
  for (const responseName of Object.keys(fields)) {
    const fieldType = resolveFieldDef(exeContext, type, fields[responseName]);
    if (!fieldType) {
      // if field does not exist, it should be ignored for compatibility concerns.
      // Usually, validation would stop it before getting here but this could be an old query
      continue;
    }
    fieldProperties[responseName] = transformNode(
      exeContext,
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
  exeContext: ExecutionContext,
  fieldNodes: FieldNode[],
  type: GraphQLType
): ObjectSchema | ArraySchema | StringSchema | NumberSchema | BooleanSchema | IntegerSchema | NullSchema {
  if (isObjectType(type)) {
    const subfields = collectSubfields(exeContext, type, fieldNodes);
    const properties = Object.create(null);
    for (const responseName of Object.keys(subfields)) {
      const fieldType = resolveFieldDef(
        exeContext,
        type,
        subfields[responseName]
      );
      if (!fieldType) {
        // if field does not exist, it should be ignored for compatibility concerns.
        // Usually, validation would stop it before getting here but this could be an old query
        continue;
      }
      properties[responseName] = transformNode(
        exeContext,
        subfields[responseName],
        fieldType.type
      );
    }
    return {
      type: "object",
      nullable: true,
      properties
    };
  }
  if (isListType(type)) {
    return {
      type: "array",
      nullable: true,
      items: transformNode(exeContext, fieldNodes, type.ofType)
    };
  }
  if (isNonNullType(type)) {
    const nullable = transformNode(exeContext, fieldNodes, type.ofType);
    if ('nullable' in nullable) delete nullable.nullable;
    return nullable;
  }
  if (isEnumType(type)) {
    return {
      type: "string",
      nullable: true,
    };
  }
  if (isScalarType(type)) {
    const jsonSchemaType = PRIMITIVES[type.name];
    if (jsonSchemaType) {
      return {
        type: jsonSchemaType,
        nullable: true,
      } as StringSchema | NumberSchema | BooleanSchema | IntegerSchema;
    }
  }
  if (isAbstractType(type)) {
    return exeContext.schema.getPossibleTypes(type).reduce(
      (res, t) => {
        const jsonSchema = transformNode(exeContext, fieldNodes, t) as ObjectSchema;
        res.properties = { ...res.properties, ...jsonSchema.properties };
        return res;
      },
      {
        type: "object",
        nullable: true,
        properties: {}
      }
    );
  }
  throw new Error(`Got unhandled type: ${type.name}`);
}
