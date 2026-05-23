import type { ActionArgSchema, YashActionDefinition } from '../actions/types';

export function parseActionArgs(
  tokens: string[],
  schema: Record<string, ActionArgSchema>,
): { args: Record<string, unknown>; errors: string[] } {
  const raw: Record<string, string> = {};
  let currentKey: string | null = null;

  for (const token of tokens) {
    const eqIdx = token.indexOf('=');
    if (eqIdx !== -1) {
      currentKey = token.slice(0, eqIdx);
      raw[currentKey] = token.slice(eqIdx + 1);
    } else if (currentKey !== null) {
      raw[currentKey] = `${raw[currentKey]} ${token}`;
    }
  }

  const args: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!(key in schema)) {
      errors.push(`Unknown argument: ${key}`);
      continue;
    }
    const def = schema[key] as ActionArgSchema;
    const value = raw[key] as string;

    if (def.type === 'string') {
      args[key] = value;
    } else if (def.type === 'number') {
      const n = parseFloat(value);
      if (Number.isNaN(n)) {
        errors.push(`Argument "${key}" must be a number, got: ${value}`);
      } else {
        args[key] = n;
      }
    } else if (def.type === 'boolean') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') {
        args[key] = true;
      } else if (lower === 'false' || lower === '0' || lower === 'no') {
        args[key] = false;
      } else {
        errors.push(`Argument "${key}" must be a boolean (true/false/1/0/yes/no), got: ${value}`);
      }
    } else if (def.type === 'enum') {
      if (def.values.includes(value)) {
        args[key] = value;
      } else {
        errors.push(`Argument "${key}" must be one of: ${def.values.join(', ')}, got: ${value}`);
      }
    }
  }

  return { args, errors };
}

export function formatActionHelp(
  def: Pick<YashActionDefinition, 'id' | 'title' | 'description' | 'args' | 'examples'>,
): string[] {
  const lines: string[] = [];

  lines.push(`${def.id} — ${def.title}`);
  lines.push(def.description);

  const argEntries = Object.entries(def.args);
  if (argEntries.length > 0) {
    lines.push('Args:');
    for (const [name, schema] of argEntries) {
      const required = schema.required === true ? 'required' : 'optional';
      const constraints = buildConstraints(schema);
      const constraintStr = constraints.length > 0 ? `   ${constraints.join(' ')}` : '';
      lines.push(`  ${name.padEnd(12)}${schema.type.padEnd(10)}${required}${constraintStr}`);
    }
  }

  const examples = def.examples;
  if (examples !== undefined && examples.length > 0) {
    lines.push('Examples:');
    for (const example of examples) {
      const argStr = Object.entries(example.args)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ');
      const label = argStr.length > 0 ? argStr : '(no args)';
      const desc = example.description !== undefined ? example.description : '';
      lines.push(`  ${label.padEnd(30)} ${desc}`);
    }
  }

  return lines;
}

function buildConstraints(schema: ActionArgSchema): string[] {
  const parts: string[] = [];
  if (schema.type === 'number') {
    if (schema.min !== undefined) parts.push(`min:${schema.min}`);
    if (schema.max !== undefined) parts.push(`max:${schema.max}`);
  } else if (schema.type === 'string') {
    if (schema.maxLength !== undefined) parts.push(`max:${schema.maxLength}`);
  } else if (schema.type === 'enum') {
    parts.push(`values: ${schema.values.join('|')}`);
  }
  return parts;
}
