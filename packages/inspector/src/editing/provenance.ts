import type { EditableField } from "./editable-model.js";
import { getByPath } from "./paths.js";

export interface FieldProvenance {
  configPath: string;
  sourceValue: unknown;
  effectiveValue: unknown;
  overridden: boolean;
}

export function computeProvenance(
  rawSource: Record<string, unknown>,
  mergedConfig: Record<string, unknown>,
  fields: EditableField[]
): FieldProvenance[] {
  return fields.map((field) => {
    const sourceValue = getByPath(rawSource, field.configPath);
    const effectiveValue = getByPath(mergedConfig, field.configPath);
    const overridden =
      sourceValue !== undefined &&
      JSON.stringify(sourceValue) !== JSON.stringify(effectiveValue);
    return { configPath: field.configPath, sourceValue, effectiveValue, overridden };
  });
}
