import type { ActionArgSchema } from './types';

export type ActionArgAutocompleteSpec =
  | { type: 'static'; values: string[]; valueHint?: string }
  | {
      type: 'provider';
      providerId: string;
      values?: string[];
      valueHint?: string;
      params?: Record<string, unknown>;
    };

export type ActionArgAutocompleteRequest = {
  actionId: string;
  argName: string;
  partial: string;
  schema: ActionArgSchema;
};

export type ActionArgAutocompleteProviderResolver = (
  request: ActionArgAutocompleteRequest & { providerId: string },
) => readonly string[] | null | undefined;

let actionArgAutocompleteProviderResolver: ActionArgAutocompleteProviderResolver | null = null;

export function setActionArgAutocompleteProviderResolver(
  resolver: ActionArgAutocompleteProviderResolver | null,
): void {
  actionArgAutocompleteProviderResolver = resolver;
}

export function getActionArgAutocompleteValueHint(schema: ActionArgSchema): string {
  if (schema.autocomplete?.valueHint) {
    return `<${schema.autocomplete.valueHint}>`;
  }
  return `<${schema.type}>`;
}

export function getActionArgAutocompleteCandidates(
  request: ActionArgAutocompleteRequest,
): string[] {
  const fromSchema = getAutocompleteValuesFromSchema(request);
  if (fromSchema.length > 0) {
    return fromSchema;
  }
  return [];
}

function getAutocompleteValuesFromSchema(request: ActionArgAutocompleteRequest): string[] {
  const { schema } = request;

  if (schema.autocomplete?.type === 'static') {
    return [...schema.autocomplete.values];
  }

  if (schema.autocomplete?.type === 'provider') {
    const resolved = actionArgAutocompleteProviderResolver?.({
      ...request,
      providerId: schema.autocomplete.providerId,
    });
    if (resolved && resolved.length > 0) {
      return [...resolved];
    }
    if (schema.autocomplete.values && schema.autocomplete.values.length > 0) {
      return [...schema.autocomplete.values];
    }
  }

  if (schema.type === 'enum') {
    return [...schema.values];
  }

  return [];
}
