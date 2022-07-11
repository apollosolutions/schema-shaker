import { composeServices } from "@apollo/composition";
import { operationFromDocument } from "@apollo/federation-internals";
import { QueryPlanner } from "@apollo/query-planner";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { GraphQLError, parse, print, validate } from "graphql";
import {
  collectUsedSchemaCoordinates,
  collectUsedSchemaCoordinatesFromFederationDirectives,
  removeUnusedSchemaElements,
} from "./src/shaking.js";
import {
  collectFetchNodes,
  convertFetchRequiresToFragment,
} from "./src/query-planning.js";

/**
 * @param {import("@apollo/federation-internals").ServiceDefinition[]} subgraphs
 * @param {import("graphql").DocumentNode[]} operations
 * @returns {import("./types.js").TreeShakeResult}
 */
export function treeShakeSupergraph(subgraphs, operations) {
  const compositionResult = composeServices(subgraphs);

  if (compositionResult.errors) {
    console.log(compositionResult.errors);
    throw new Error("could not compose");
  }

  const queryPlanner = new QueryPlanner(compositionResult.schema);
  const fetchNodes = operations.flatMap((doc) => {
    const op = operationFromDocument(compositionResult.schema, doc);
    const qp = queryPlanner.buildQueryPlan(op);
    return collectFetchNodes(qp);
  });

  const newSubgraphs = subgraphs
    .map((subgraph) => {
      const relevantFetchNodes = fetchNodes.filter(
        (node) => node.serviceName === subgraph.name
      );

      const newTypeDefs = shakeSubgraphSchema(subgraph, relevantFetchNodes);

      if (!newTypeDefs) return null;

      return {
        ...subgraph,
        typeDefs: newTypeDefs,
      };
    })
    .filter(
      /** @returns {a is import("@apollo/federation-internals").ServiceDefinition} */
      (a) => Boolean(a)
    );

  const recompositionResult = composeServices(newSubgraphs);

  if (recompositionResult.errors) {
    return {
      kind: "COMPOSITION_FAILURE",
      subgraphs: newSubgraphs,
      errors: recompositionResult.errors,
    };
  } else {
    const apiSchema = recompositionResult.schema
      .toAPISchema()
      .toGraphQLJSSchema();

    /** @type {Map<string, readonly GraphQLError[]>} */
    const errorsByOperation = new Map();

    for (const operation of operations) {
      const errors = validate(apiSchema, operation);
      if (errors?.length) {
        errorsByOperation.set(print(operation), errors);
      }
    }

    if (errorsByOperation.size > 0) {
      return {
        kind: "OPERATION_VALIDATION_FAILURE",
        subgraphs: newSubgraphs,
        errors: errorsByOperation,
      };
    }
  }

  return {
    kind: "SUCCESS",
    subgraphs: newSubgraphs,
  };
}

/**
 * @param {import("@apollo/federation-internals").ServiceDefinition} subgraph
 * @param {import("@apollo/query-planner").FetchNode[]} fetchNodes
 */
function shakeSubgraphSchema(subgraph, fetchNodes) {
  const schema = buildSubgraphSchema({ typeDefs: subgraph.typeDefs });

  const usedCoordinatesFromOperationSelections = fetchNodes.flatMap((node) => [
    ...collectUsedSchemaCoordinates(parse(node.operation), schema),
  ]);

  const usedCoordinatedFromFetchRequires = fetchNodes.flatMap((node) =>
    (node.requires ?? []).flatMap((node) => {
      const op = convertFetchRequiresToFragment(node);
      return [...collectUsedSchemaCoordinates(op, schema)];
    })
  );

  const currentlyUsed = new Set([
    ...usedCoordinatesFromOperationSelections,
    ...usedCoordinatedFromFetchRequires,
  ]);

  const usedCoordinatedFromKeyDirectives =
    collectUsedSchemaCoordinatesFromFederationDirectives(schema, currentlyUsed);

  const allUsed = new Set([
    ...usedCoordinatesFromOperationSelections,
    ...usedCoordinatedFromFetchRequires,
    ...usedCoordinatedFromKeyDirectives,
  ]);

  if (allUsed.size < 1) {
    return null;
  }

  return removeUnusedSchemaElements(allUsed, subgraph.typeDefs, schema);
}
