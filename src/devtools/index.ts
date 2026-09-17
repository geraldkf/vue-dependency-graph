import { coreLayerName } from "../core";

/**
 * Placeholder. This module exists only to reserve the `./devtools` package
 * export and bootstrap layer name; it has no devtools functionality yet.
 * If you're importing from `vue-dependency-graph/devtools`, there is
 * currently nothing here to use - either build it out, or drop the export
 * from package.json until there is.
 */
export const devtoolsLayerName = `devtools:${coreLayerName}` as const;
