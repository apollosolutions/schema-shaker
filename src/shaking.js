import { getDirective } from "@graphql-tools/utils";
import {
  getNamedType,
  GraphQLSchema,
  isInputObjectType,
  isInterfaceType,
  isIntrospectionType,
  isObjectType,
  Kind,
  parse,
  TypeInfo,
  visit,
  visitWithTypeInfo,
} from "graphql";
import { assert } from "./assert.js";
import {
  isInterfaceTypeNode,
  isObjectTypeNode,
  isUnionTypeNode,
} from "./ast-types.js";
import { SchemaTypeInfo } from "./SchemaTypeInfo.js";

/**
 * @param {import("graphql").DocumentNode} operation
 * @param {GraphQLSchema} schema
 */
export function collectUsedSchemaCoordinates(operation, schema) {
  /** @type {Set<string>} */
  const schemaCoordinates = new Set();

  const typeInfo = new TypeInfo(schema);

  const interfaceTypes = Object.values(schema.getTypeMap()).filter(
    isInterfaceType
  );

  visit(
    operation,
    visitWithTypeInfo(typeInfo, {
      [Kind.FIELD]: {
        enter() {
          const field = typeInfo.getFieldDef();
          assert(field, `field definition missing`);

          const parentType = typeInfo.getParentType();
          assert(parentType, `parentType missing`);

          const type = typeInfo.getType();
          assert(type, `return type missing`);

          const namedReturnType = getNamedType(type);

          if (isIntrospectionType(parentType)) {
            return;
          }

          if (isIntrospectionType(namedReturnType)) {
            return;
          }

          const fieldCoordinate = `${parentType.name}.${field.name}`;
          if (!field.name.startsWith("__"))
            schemaCoordinates.add(fieldCoordinate);

          schemaCoordinates.add(parentType.name);
          schemaCoordinates.add(namedReturnType.name);

          // if this type is a possible type of an interface, add the interface's
          // matching fields to the list of used coordinates
          if (isObjectType(parentType) || isInterfaceType(parentType)) {
            for (const interfaceType of interfaceTypes) {
              if (
                schema.isSubType(interfaceType, parentType) &&
                interfaceType.getFields()[field.name]
              ) {
                schemaCoordinates.add(`${interfaceType.name}.${field.name}`);
                schemaCoordinates.add(`${parentType.name}.${field.name}`);
              }
            }
          }
        },
      },
      [Kind.ARGUMENT]: {
        enter() {
          const arg = typeInfo.getArgument();
          assert(arg, `arg definition missing ${arg?.name}`);

          const inputType = getNamedType(arg.type);
          schemaCoordinates.add(inputType.name);

          // once we see an input type, we'll mark all of its fields and
          // each field type as used because we don't know what fields are
          // used in variables
          if (isInputObjectType(inputType)) {
            for (const inputField of Object.values(inputType.getFields())) {
              schemaCoordinates.add(`${inputType.name}.${inputField.name}`);
              schemaCoordinates.add(getNamedType(inputField.type).name);
            }
          }

          const field = typeInfo.getFieldDef();
          const parentType = typeInfo.getParentType();

          const argCoordinate = `${parentType?.name}.${field?.name}(${arg?.name}:)`;
          schemaCoordinates.add(argCoordinate);
        },
      },
    })
  );

  return schemaCoordinates;
}

/**
 * For all retained elements, this ensures that @key and @requires directives
 * continue to be valid by marking the fields in their selection sets as used
 * @param {GraphQLSchema} schema
 * @param {Set<string>} usedCoordinates
 */
export function collectUsedSchemaCoordinatesFromFederationDirectives(
  schema,
  usedCoordinates
) {
  /** @type {Set<string>} */
  const schemaCoordinates = new Set();

  for (const type of Object.values(schema.getTypeMap())) {
    // only keep directive-specified fields on types currently used
    if (!usedCoordinates.has(type.name)) {
      continue;
    }

    const keys = getDirective(schema, type, "key") ?? [];
    for (const key of keys) {
      const doc = parse(`fragment f on ${type.name} { ${key.fields} }`);
      for (const used of collectUsedSchemaCoordinates(doc, schema)) {
        schemaCoordinates.add(used);
      }
    }

    if ("getFields" in type) {
      for (const fieldDef of Object.values(type.getFields())) {
        const requires = getDirective(schema, fieldDef, "requires") ?? [];
        for (const require of requires) {
          const doc = parse(`fragment f on ${type.name} { ${require.fields} }`);
          for (const used of collectUsedSchemaCoordinates(doc, schema)) {
            schemaCoordinates.add(used);
          }
        }
      }
    }
  }

  return schemaCoordinates;
}

/**
 * @param {Set<string>} usedCoordinates
 * @param {import("graphql").DocumentNode} schemaAst
 * @param {GraphQLSchema} schema
 */
export function removeUnusedSchemaElements(usedCoordinates, schemaAst, schema) {
  const typeInfo = new SchemaTypeInfo(schema);

  return visit(schemaAst, {
    enter(node) {
      typeInfo.enter(node);

      // remove "implements X" for removed interfaces
      if (isObjectTypeNode(node) || isInterfaceTypeNode(node)) {
        node = {
          ...node,
          interfaces: node.interfaces?.filter((i) =>
            usedCoordinates.has(i.name.value)
          ),
        };
      }

      // remove unused members of a union
      if (isUnionTypeNode(node)) {
        node = {
          ...node,
          types: node.types?.filter((t) => usedCoordinates.has(t.name.value)),
        };
      }

      const coord = (() => {
        switch (node.kind) {
          case Kind.OBJECT_TYPE_DEFINITION:
          case Kind.OBJECT_TYPE_EXTENSION:
          case Kind.INTERFACE_TYPE_DEFINITION:
          case Kind.INTERFACE_TYPE_EXTENSION:
          case Kind.UNION_TYPE_DEFINITION:
          case Kind.UNION_TYPE_EXTENSION:
          case Kind.SCALAR_TYPE_DEFINITION:
          case Kind.SCALAR_TYPE_EXTENSION:
          case Kind.ENUM_TYPE_DEFINITION:
          case Kind.ENUM_TYPE_EXTENSION:
          case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          case Kind.INPUT_OBJECT_TYPE_EXTENSION:
            return node.name.value;
          case Kind.FIELD_DEFINITION:
            return typeInfo.fieldCoordinate(node.name.value);
          case Kind.INPUT_VALUE_DEFINITION: {
            return typeInfo.inputValueCoordinate(node.name.value);
          }
        }
      })();

      if (coord && !usedCoordinates.has(coord)) {
        // the `leave` visitor method isn't called if we return null here
        typeInfo.leave(node);
        return null;
      }

      return node;
    },

    leave(node) {
      typeInfo.leave(node);
    },
  });
}
