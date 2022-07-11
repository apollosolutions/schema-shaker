# Schema Shaker

Given subgraph schemas and a set of operations, reduce the subgraphs to only the elements needed for those operations and query planning by "tree shaking" the supergraph.

**The code in this repository is experimental and has been provided for reference purposes only. Community feedback is welcome but this project may not be supported in the same way that repositories in the official [Apollo GraphQL GitHub organization](https://github.com/apollographql) are. If you need help you can file an issue on this repository, [contact Apollo](https://www.apollographql.com/contact-sales) to talk to an expert, or create a ticket directly in Apollo Studio.**

## Example Usage

The supergraph config file format matches [rover's supergraph compose](https://www.apollographql.com/docs/rover/commands/supergraphs#yaml-configuration-file) config format.

The `--operations` argument is a file glob.

The `--out` argument is a folder to store a new supergraph config and subgraph schema files. Use the new supergraph config with `rover supergraph compose` to generate a new supergraph schema.

```sh
npx github:@apollosolutions/schema-shaker \
  --config supergraph.yaml \
  --operations operations/*.graphql \
  --out outdir
```

When `--out` is not set, the command prints a new supergraph config to stdout.

After tree shaking, the script recomposes the smaller subgraphs and revalidates the original operations against the new API schema. It will still output supergraph configs and subgraph schemas, but if there are errors in the console then they're most likely not valid.
