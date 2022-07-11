import { Kind } from "graphql";

/**
 * @param {any} node
 * @returns {node is import("graphql").ObjectTypeDefinitionNode | import("graphql").ObjectTypeExtensionNode}
 */
export function isObjectTypeNode(node) {
  return (
    node.kind === Kind.OBJECT_TYPE_DEFINITION ||
    node.kind === Kind.OBJECT_TYPE_EXTENSION
  );
}

/**
 * @param {any} node
 * @returns {node is import("graphql").InterfaceTypeDefinitionNode | import("graphql").InterfaceTypeExtensionNode}
 */
export function isInterfaceTypeNode(node) {
  return (
    node.kind === Kind.INTERFACE_TYPE_DEFINITION ||
    node.kind === Kind.INTERFACE_TYPE_EXTENSION
  );
}

/**
 * @param {any} node
 * @returns {node is import("graphql").InputObjectTypeDefinitionNode | import("graphql").InputObjectTypeExtensionNode}
 */
export function isInputObjectTypeNode(node) {
  return (
    node.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ||
    node.kind === Kind.INPUT_OBJECT_TYPE_EXTENSION
  );
}

/**
 * @param {any} node
 * @returns {node is import("graphql").FieldDefinitionNode}
 */
export function isFieldDefinitionNode(node) {
  return node.kind === Kind.FIELD_DEFINITION;
}

/**
 * @param {any} node
 * @returns {node is import("graphql").UnionTypeDefinitionNode | import("graphql").UnionTypeExtensionNode}
 */
export function isUnionTypeNode(node) {
  return node.kind === Kind.UNION_TYPE_DEFINITION;
}
