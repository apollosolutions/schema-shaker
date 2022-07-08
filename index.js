import { composeServices } from "@apollo/composition";
import { operationFromDocument } from "@apollo/federation-internals";
import { QueryPlanner } from "@apollo/query-planner";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse, print, validate } from "graphql";
import {
  collectFetchNodes,
  collectUsedSchemaCoordinates,
  collectUsedSchemaCoordinatesFromFederationDirectives,
  convertFetchRequiresToFragment,
  removeUsedSchemaElements,
} from "./src/fns.js";

/**
 *
 * @param {import("@apollo/federation-internals").ServiceDefinition[]} subgraphs
 * @param {import("graphql").DocumentNode[]} operations
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
      // console.log(subgraph.name);

      const schema = buildSubgraphSchema({ typeDefs: subgraph.typeDefs });

      const relevantFetchNodes = fetchNodes.filter(
        (node) => node.serviceName === subgraph.name
      );

      const usedCoordinatesFromOperationSelections = relevantFetchNodes.flatMap(
        (node) => [
          ...collectUsedSchemaCoordinates(parse(node.operation), schema),
        ]
      );

      const usedCoordinatedFromFetchRequires = relevantFetchNodes.flatMap(
        (node) =>
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
        collectUsedSchemaCoordinatesFromFederationDirectives(
          schema,
          currentlyUsed
        );

      const allUsed = new Set([
        ...usedCoordinatesFromOperationSelections,
        ...usedCoordinatedFromFetchRequires,
        ...usedCoordinatedFromKeyDirectives,
      ]);

      // console.log(allUsed);

      if (allUsed.size < 1) {
        return null;
      }

      const newTypeDefs = removeUsedSchemaElements(
        allUsed,
        subgraph.typeDefs,
        schema
      );

      // console.log(print(newTypeDefs));

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
    console.log(recompositionResult.errors);
    // throw new Error("could not compose new subgraphs");
  } else {
    const apiSchema = recompositionResult.schema
      .toAPISchema()
      .toGraphQLJSSchema();

    for (const operation of operations) {
      const errors = validate(apiSchema, operation);
      if (errors?.length) {
        console.log(errors);
        console.log(print(operation));
        // throw new Error("operation no longer valid");
      }
    }
  }

  return newSubgraphs;
}
