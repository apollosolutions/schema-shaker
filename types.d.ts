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
