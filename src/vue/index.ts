import { coreLayerName } from "../core";

/** Identifies the Vue integration layer during repository bootstrap. */
export const vueLayerName = `vue:${coreLayerName}` as const;
