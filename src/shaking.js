import { getDirective } from "@graphql-tools/utils";
import {
  getNamedType,
  GraphQLInterfaceType,
  GraphQLObjectType,
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
  isInputObjectTypeNode,
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

  /** @type {Map<string, Set<string>>} */
  const markedInterfaceFields = new Map();

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

          if (
            isIntrospectionType(parentType) ||
            isIntrospectionType(namedReturnType)
          ) {
            return;
          }

          const fieldCoordinate = `${parentType.name}.${field.name}`;
          if (!field.name.startsWith("__"))
            schemaCoordinates.add(fieldCoordinate);

          schemaCoordinates.add(parentType.name);
          schemaCoordinates.add(namedReturnType.name);

          if (isInterfaceType(parentType)) {
            if (!markedInterfaceFields.has(parentType.name)) {
              markedInterfaceFields.set(parentType.name, new Set());
            }
            markedInterfaceFields.get(parentType.name)?.add(field.name);
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

  const implementingTypes = Object.values(schema.getTypeMap()).filter(
    /** @returns {t is GraphQLInterfaceType | GraphQLObjectType} */
    (t) =>
      (isObjectType(t) || isInterfaceType(t)) && t.getInterfaces().length > 0
  );

  // if the operation selects an interface's field, we'll need all objects
  // implementing that interface to implement the field so that they
  // continue to be valid
  for (const [interfaceName, fieldNames] of markedInterfaceFields) {
    const interfaceType = schema.getType(interfaceName);
    if (!isInterfaceType(interfaceType)) continue;

    for (const fieldName of fieldNames) {
      for (const implementingType of implementingTypes) {
        if (
          schema.isSubType(interfaceType, implementingType) &&
          interfaceType.getFields()[fieldName]
        ) {
          // this doesn't add the implementing type coordinate to the list --
          // if we never use the type, then it should be removed even if
          // the fields might be "used"
          schemaCoordinates.add(`${implementingType.name}.${fieldName}`);
        }
      }
    }

    for (const field of Object.values(interfaceType.getFields())) {
      const fieldCoordinate = `${interfaceType.name}.${field.name}`;
      if (schemaCoordinates.has(fieldCoordinate)) {
        for (const implementingType of implementingTypes) {
          if (schema.isSubType(interfaceType, implementingType)) {
            schemaCoordinates.add(`${implementingType.name}.${field.name}`);
          }
        }
      }

      for (const implementingType of implementingTypes) {
        if (schema.isSubType(interfaceType, implementingType)) {
          const fieldCoordinate = `${implementingType.name}.${field.name}`;
          if (schemaCoordinates.has(fieldCoordinate)) {
            schemaCoordinates.add(`${interfaceType.name}.${field.name}`);
          }
        }
      }
    }
  }

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
  const rootTypes = {
    queryName: schema.getQueryType()?.name,
    mutationName: schema.getMutationType()?.name,
    subscriptionName: schema.getSubscriptionType()?.name,
    hasQueryType: false,
    hasMutationType: false,
    hasSubscriptionType: false,
    /**
     * @param {string | undefined} name
     */
    mark(name) {
      if (this.queryName === name) this.hasQueryType = true;
      if (this.mutationName === name) this.hasMutationType = true;
      if (this.subscriptionName === name) this.hasSubscriptionType = true;
    },
    /**
     * @param {import("graphql").SchemaDefinitionNode} schemaDef
     */
    mutate(schemaDef) {
      const operationTypes = schemaDef.operationTypes.filter((t) => {
        switch (t.operation) {
          case "query":
            return this.hasQueryType;
          case "mutation":
            return this.hasMutationType;
          case "subscription":
            return this.hasSubscriptionType;
        }
      });

      if (operationTypes.length === 0 && !schemaDef.directives?.length) {
        return null;
      }

      return {
        ...schemaDef,
        kind:
          operationTypes.length === 0 ? Kind.SCHEMA_EXTENSION : schemaDef.kind,
        operationTypes,
      };
    },
  };

  const shaken = visit(schemaAst, {
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
          case Kind.INPUT_VALUE_DEFINITION:
            return typeInfo.inputValueCoordinate(node.name.value);
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

      // remove empty container types
      if (
        isObjectTypeNode(node) ||
        isInterfaceTypeNode(node) ||
        isInputObjectTypeNode(node)
      ) {
        if (node.fields?.length === 0) {
          return null;
        }
      }
    },
  });

  return visit(shaken, {
    [Kind.OBJECT_TYPE_DEFINITION]: {
      enter(node) {
        rootTypes.mark(node.name.value);
      },
    },
    [Kind.OBJECT_TYPE_EXTENSION]: {
      enter(node) {
        rootTypes.mark(node.name.value);
      },
    },
    [Kind.SCHEMA_DEFINITION]: {
      leave(node) {
        return rootTypes.mutate(node);
      },
    },
  });
}
