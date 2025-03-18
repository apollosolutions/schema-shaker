import { composeServices as composeServicesV2 } from "@apollo/composition";
import { composeAndValidate } from "@apollo/federation-1";
import { Supergraph } from "@apollo/federation-internals";
import { buildComposedSchema } from "@apollo/query-planner-1";
import { parse, print } from "graphql";

/**
 * @param {import("@apollo/federation-internals").ServiceDefinition[]} services
 * @param {string} version
 * @returns {import("@apollo/federation-internals").Supergraph?}
 */
export function composeServices(services, version) {
  if (version === "2") {
    const composition = composeServicesV2(services);
    if (composition.errors) {
      console.log(composition.errors)
      return null;
    }
    if (!composition.supergraphSdl) {
      throw new Error("dont know what to do with composition result");
    }
    return Supergraph.build(composition.supergraphSdl);
  } else {
    const fed1Result = composeServicesV1(services);
    if (fed1Result.supergraphSdl) {
      return Supergraph.build(fed1Result.supergraphSdl);
    } else if (fed1Result.errors) {
      return null;
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
