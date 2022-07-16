import { GraphQLSchema, isInterfaceType, isObjectType } from "graphql";
import { assert } from "./assert.js";
import {
  isFieldDefinitionNode,
  isInputObjectTypeNode,
  isInterfaceTypeNode,
  isObjectTypeNode,
} from "./ast-types.js";

/**
 * The standard TypeInfo class only works for walking operation ASTs. This
 * keeps track of entered types and fields to determine coordinates for fields
 * and arguments within them.
 */
export class SchemaTypeInfo {
  /** @type {import("graphql").GraphQLNamedType | undefined} */
  #parentType = undefined;

  /** @type {import("graphql").GraphQLField<*, *> | undefined} */
  #parentField = undefined;

  /** @type {import("graphql").GraphQLNamedType | undefined} */
  #parentInputType = undefined;

  /** @type {GraphQLSchema} */
  #schema;

  /**
   * @param {GraphQLSchema} schema
   */
  constructor(schema) {
    this.#schema = schema;
  }

  /**
   * @param {import("graphql").ASTNode} node
   */
  enter(node) {
    if (isObjectTypeNode(node) || isInterfaceTypeNode(node)) {
      this.#parentType = this.#schema.getType(node.name.value);
    }

    if (isInputObjectTypeNode(node)) {
      this.#parentInputType = this.#schema.getType(node.name.value);
    }

    if (isFieldDefinitionNode(node)) {
      assert(
        this.#parentType,
        `invalid parent type for field def \`${node.name.value}\``
      );

      assert(
        isObjectType(this.#parentType) || isInterfaceType(this.#parentType),
        `invalid parent type for field def \`${node.name.value}\``
      );

      this.#parentField = this.#parentType.getFields()[node.name.value];
    }
  }

  /**
   * @param {import("graphql").ASTNode} node
   */
  leave(node) {
    if (isObjectTypeNode(node) || isInterfaceTypeNode(node)) {
      this.#parentType = undefined;
    }

    if (isInputObjectTypeNode(node)) {
      this.#parentInputType = undefined;
    }

    if (isFieldDefinitionNode(node)) {
      this.#parentField = undefined;
    }
  }

  /**
   * @param {string} fieldName
   */
  fieldCoordinate(fieldName) {
    assert(this.#parentType, `no parent type for ${fieldName}`);
    return `${this.#parentType.name}.${fieldName}`;
  }

  /**
   * @param {string} fieldOrArgumentName
   */
  inputValueCoordinate(fieldOrArgumentName) {
    if (this.#parentType && this.#parentField) {
      // arguments
      return `${this.#parentType.name}.${
        this.#parentField.name
      }(${fieldOrArgumentName}:)`;
    } else if (this.#parentInputType) {
      // input fields
      return `${this.#parentInputType.name}.${fieldOrArgumentName}`;
    }
    // this is probably directive argument, ignoring
  }
}
