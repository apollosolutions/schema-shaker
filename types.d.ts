import { ServiceDefinition } from "@apollo/federation-internals";

interface SupergraphConfig {
  subgraphs: Record<string, SubgraphConfig>;
  federation_version?: "1" | "2";
}

interface SubgraphConfig {
  routing_url?: string | undefined;
  schema: SchemaConfig;
}

type SchemaConfig =
  | SdlSchemaConfig
  | FileSchemaConfig
  | IntrospectionSchemaConfig
  | GraphRefSchemaConfig;

interface SdlSchemaConfig {
  sdl: string;
}

interface FileSchemaConfig {
  file: string;
}

interface IntrospectionSchemaConfig {
  subgraph_url: string;
}

interface GraphRefSchemaConfig {
  graphref: string;
  subgraph: string;
}

interface TreeShakeSuccess {
  kind: "SUCCESS";
  subgraphs: ServiceDefinition[];
}

interface TreeShakeCompositionFailure {
  kind: "COMPOSITION_FAILURE";
  subgraphs: ServiceDefinition[];
  errors: GraphQLError[];
}

interface TreeShakeOperationValidationFailure {
  kind: "OPERATION_VALIDATION_FAILURE";
  subgraphs: ServiceDefinition[];
  errors: Map<string, readonly GraphQLError[]>;
}

type TreeShakeResult =
  | TreeShakeCompositionFailure
  | TreeShakeOperationValidationFailure
  | TreeShakeSuccess;
