#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "fs/promises";
import { parse, print } from "graphql";
import { dirname, resolve } from "path";
import { treeShakeSupergraph } from "../index.js";
import { Command, Option, runExit } from "clipanion";
import { globby } from "globby";
import { dump, load } from "js-yaml";

runExit(
  class DefaultCommand extends Command {
    config = Option.String("--config", { required: true });

    operations = Option.String("--operations", { required: true });

    out = Option.String("--out");

    async execute() {
      const configPath = resolve(process.cwd(), this.config);

      const supergraphConfig =
        /** @type {import("../types.js").SupergraphConfig} */ (
          load(await readFile(configPath, "utf-8"))
        );

      const compositionVersion =
        /** @type {"1" | "2" | undefined} */
        (`${supergraphConfig.federation_version}`) ?? "1";

      const operationPaths = await globby(this.operations);

      const operations = await Promise.all(
        operationPaths.map(async (path) => {
          const operationPath = resolve(process.cwd(), path);
          return parse(await readFile(operationPath, "utf-8"));
        })
      );

      const serviceDefinitions = await supergraphConfigToServiceDefinitions(
        supergraphConfig,
        dirname(configPath)
      );

      const result = treeShakeSupergraph(serviceDefinitions, operations, {
        compositionVersion,
      });

      if (result.kind === "COMPOSITION_FAILURE") {
        this.context.stderr.write(
          "⚠️⚠️⚠️ Composition failed after tree shaking ⚠️⚠️⚠️\n"
        );
        this.context.stderr.write(
          `Error count: ${result.errors.length} errors\n`
        );
        this.context.stderr.write(
          result.errors.map((e) => e.message).join("\n")
        );
        this.context.stderr.write("\n");
      }

      if (result.kind === "OPERATION_VALIDATION_FAILURE") {
        this.context.stderr.write(
          "⚠️⚠️⚠️ Operations are no longer valid against new supergraph ⚠️⚠️⚠️\n"
        );
        for (const [operation, errors] of result.errors) {
          this.context.stderr.write(operation);
          this.context.stderr.write(`Error count: ${errors.length} errors\n`);
          this.context.stderr.write(errors.map((e) => e.message).join("\n"));
          this.context.stderr.write("\n");
          this.context.stderr.write("-".repeat(32));
          this.context.stderr.write("\n");
        }
      }

      if (this.out) {
        const outDir = resolve(process.cwd(), this.out);
        await mkdir(outDir, { recursive: true });
        const config = serviceDefinitionsToSupergraphConfig(result.subgraphs, {
          files: true,
          federationVersion: compositionVersion,
        });

        await writeFile(
          resolve(outDir, "supergraph.yaml"),
          dump(config),
          "utf-8"
        );
        for (const service of result.subgraphs) {
          await writeFile(
            resolve(outDir, `${service.name}.graphql`),
            print(service.typeDefs),
            "utf-8"
          );
        }
      } else {
        console.log(
          dump(
            serviceDefinitionsToSupergraphConfig(result.subgraphs, {
              files: false,
              federationVersion: compositionVersion,
            })
          )
        );
      }
    }
  }
);

/**
 * @param {import("../types.js").SupergraphConfig} supergraphConfig
 * @param {string} pwd
 * @returns {Promise<import("@apollo/federation-internals").ServiceDefinition[]>}
 */
async function supergraphConfigToServiceDefinitions(supergraphConfig, pwd) {
  /** @type {import("@apollo/federation-internals").ServiceDefinition[]} */
  const definitions = [];

  for (const [name, { routing_url: url, schema }] of Object.entries(
    supergraphConfig.subgraphs
  )) {
    const typeDefs = await (async () => {
      if ("sdl" in schema) {
        return parse(schema.sdl);
      } else if ("file" in schema) {
        return parse(await readFile(resolve(pwd, schema.file), "utf-8"));
      } else {
        throw new Error(`TODO support for ${JSON.stringify(schema)}`);
      }
    })();

    definitions.push({
      name,
      url,
      typeDefs,
    });
  }

  return definitions;
}

/**
 * @param {import("@apollo/federation-internals").ServiceDefinition[]} serviceDefinitions
 * @param {{ files: boolean; federationVersion: '1' | '2' }} options
 * @returns {import("../types.js").SupergraphConfig}
 */
function serviceDefinitionsToSupergraphConfig(
  serviceDefinitions,
  { files, federationVersion }
) {
  return {
    subgraphs: Object.fromEntries(
      serviceDefinitions.map((def) => [
        def.name,
        {
          routing_url: def.url,
          schema: files
            ? { file: `./${def.name}.graphql` }
            : { sdl: print(def.typeDefs) },
        },
      ])
    ),
    federation_version: federationVersion,
  };
}
