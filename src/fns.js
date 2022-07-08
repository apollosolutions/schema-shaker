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

/**
 * @param {any} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 *
 * @param {import("@apollo/query-planner").QueryPlan} qp
 */
export function collectFetchNodes(qp) {
  /** @type {import("@apollo/query-planner").FetchNode[]} */
  const nodes = [];

  /**
   * @param {import("@apollo/query-planner").PlanNode} node
   */
  function recurse(node) {
    switch (node.kind) {
      case "Fetch":
        nodes.push(node);
        break;
      case "Flatten":
        recurse(node.node);
        break;
      case "Parallel":
      case "Sequence":
        node.nodes.forEach((node) => recurse(node));
    }
  }

  if (qp.node) recurse(qp.node);

  return nodes;
}

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
    // only keep directive-based fields on types currently used
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
export function removeUsedSchemaElements(usedCoordinates, schemaAst, schema) {
  const typeInfo = new TypeInfo(schema);

  /** @type {import("graphql").GraphQLNamedType | undefined} */
  let parentType;

  /** @type {import("graphql").GraphQLNamedType | undefined} */
  let parentInputType;

  /** @type {import("graphql").GraphQLField<*, *> | undefined} */
  let parentField;

  const nullOnLeave = new Set();

  return visit(
    schemaAst,
    visitWithTypeInfo(typeInfo, {
      enter(node) {
        if (
          node.kind === Kind.OBJECT_TYPE_DEFINITION ||
          node.kind === Kind.OBJECT_TYPE_EXTENSION ||
          node.kind === Kind.INTERFACE_TYPE_DEFINITION ||
          node.kind === Kind.INTERFACE_TYPE_EXTENSION
        ) {
          // console.log("-> PARENT", node.name.value);
          parentType = schema.getType(node.name.value);

          // remove "implements X" when interfaces no longer exist
          node = {
            ...node,
            interfaces: node.interfaces?.filter((i) =>
              usedCoordinates.has(i.name.value)
            ),
          };
        }

        if (
          node.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ||
          node.kind === Kind.INPUT_OBJECT_TYPE_EXTENSION
        ) {
          // console.log("-> INPUT", node.name.value);
          parentInputType = schema.getType(node.name.value);
        }

        if (node.kind === Kind.FIELD_DEFINITION) {
          if (
            !parentType ||
            !(isObjectType(parentType) || isInterfaceType(parentType))
          ) {
            throw new Error(
              `invalid parent type for field def \`${node.name.value}\``
            );
          }
          parentField = parentType.getFields()[node.name.value];
        }

        // remove unused members of a union
        if (node.kind === Kind.UNION_TYPE_DEFINITION) {
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
              return `${parentType?.name}.${node.name.value}`;
            case Kind.INPUT_VALUE_DEFINITION: {
              if (parentType) {
                // arguments
                return `${parentType?.name}.${parentField?.name}(${node.name.value}:)`;
              } else if (parentInputType) {
                // input fields
                return `${parentInputType.name}.${node.name.value}`;
              }
            }
          }
        })();

        if (coord && !usedCoordinates.has(coord)) {
          if (
            (node.kind === Kind.OBJECT_TYPE_DEFINITION ||
              node.kind === Kind.OBJECT_TYPE_EXTENSION ||
              node.kind === Kind.INTERFACE_TYPE_DEFINITION ||
              node.kind === Kind.INTERFACE_TYPE_EXTENSION) &&
            parentType?.name === node.name.value
          ) {
            parentType = undefined;
          }

          // leave is not called if we return null
          if (
            (node.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ||
              node.kind === Kind.INPUT_OBJECT_TYPE_EXTENSION) &&
            parentInputType?.name === node.name.value
          ) {
            parentInputType = undefined;
          }
          return null;
        }

        return node;
      },
      leave(node) {
        if (
          node.kind === Kind.OBJECT_TYPE_DEFINITION ||
          node.kind === Kind.OBJECT_TYPE_EXTENSION ||
          node.kind === Kind.INTERFACE_TYPE_DEFINITION ||
          node.kind === Kind.INTERFACE_TYPE_EXTENSION
        ) {
          // console.log("<- PARENT", node.name.value);
          parentType = undefined;
        }

        if (
          node.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ||
          node.kind === Kind.INPUT_OBJECT_TYPE_EXTENSION
        ) {
          // console.log("<- INPUT", node.name.value);
          parentInputType = undefined;
        }

        if (node.kind === Kind.FIELD_DEFINITION) {
          parentField = undefined;
        }

        if (nullOnLeave.has(node)) {
          return null;
        }
      },
    })
  );
}

/**
 * @param {import("@apollo/query-planner").QueryPlanSelectionNode} node
 * @returns {import("graphql").DocumentNode}
 */
export function convertFetchRequiresToFragment(node) {
  switch (node.kind) {
    case "InlineFragment":
      return {
        kind: Kind.DOCUMENT,
        definitions: [
          {
            kind: Kind.FRAGMENT_DEFINITION,
            name: { kind: Kind.NAME, value: "f" },
            typeCondition: {
              kind: Kind.NAMED_TYPE,
              name: { kind: Kind.NAME, value: node.typeCondition ?? "" },
            },
            selectionSet: {
              kind: Kind.SELECTION_SET,
              selections: node.selections.map((s) => {
                switch (s.kind) {
                  case "Field":
                    /** @type {import("graphql").FieldNode} */
                    return {
                      kind: Kind.FIELD,
                      name: { kind: Kind.NAME, value: s.name },
                    };
                  case "InlineFragment":
                    throw new Error(
                      `dont know what to do with ${JSON.stringify(s)}`
                    );
                  default:
                    throw new Error(
                      `dont know what to do with ${JSON.stringify(s)}`
                    );
                }
              }),
            },
          },
        ],
      };
    case "Field":
      throw new Error(`dont know what to do with ${JSON.stringify(node)}`);
  }
}
