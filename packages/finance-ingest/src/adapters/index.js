import { harewoodFolderAdapter, scanHarewoodFolder } from "./harewood-folder.js";
import { historicalPackAdapter, scanHistoricalPack } from "./historical-pack.js";
import { plannedAdapters } from "./placeholders.js";

export const adapters = [harewoodFolderAdapter, historicalPackAdapter, ...plannedAdapters];

const implementedAdapters = new Map([
  [harewoodFolderAdapter.id, scanHarewoodFolder],
  [historicalPackAdapter.id, scanHistoricalPack],
]);

export async function runAdapter(adapterId, options) {
  const implementation = implementedAdapters.get(adapterId);
  if (!implementation) {
    const definition = adapters.find((adapter) => adapter.id === adapterId);
    if (definition) {
      throw new Error(`Adapter ${adapterId} is ${definition.status}; no source read was attempted.`);
    }
    throw new Error(`Unknown adapter: ${adapterId}`);
  }
  return implementation(options);
}
