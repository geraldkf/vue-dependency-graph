import { coreLayerName } from "../core";

/** Identifies the optional devtools layer during repository bootstrap. */
export const devtoolsLayerName = `devtools:${coreLayerName}` as const;
