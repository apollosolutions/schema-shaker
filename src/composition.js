import { composeServices as composeServicesV2 } from "@apollo/composition";
import { composeAndValidate } from "@apollo/federation-1";
import { buildSupergraphSchema } from "@apollo/federation-internals";
import { buildComposedSchema } from "@apollo/query-planner-1";
import { parse } from "graphql";

/**
 * @param {import("@apollo/federation-internals").ServiceDefinition[]} services
 * @param {string} version
 * @returns {import("@apollo/composition").CompositionResult}
 */
export function composeServices(services, version) {
  if (version === "2") {
    return composeServicesV2(services);
  } else {
    const fed1Result = composeServicesV1(services);
    if (fed1Result.supergraphSdl) {
      const [schema] = buildSupergraphSchema(fed1Result.supergraphSdl);
      return {
        schema,
        supergraphSdl: fed1Result.supergraphSdl,
        hints: [],
      };
    } else if (fed1Result.errors) {
      return {
        errors: fed1Result.errors,
      };
    } else {
      throw new Error("dont know what to do with composition result");
    }
  }
}

/**
 * @param {import("@apollo/federation-internals").ServiceDefinition[]} services
 */
function composeServicesV1(services) {
  const result = composeAndValidate(services);

  if (result.supergraphSdl) {
    return {
      schema: buildComposedSchema(parse(result.supergraphSdl)),
      supergraphSdl: result.supergraphSdl,
    };
  }
  return result;
}
