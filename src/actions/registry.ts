import {
  type ActionContext,
  type ActionResult,
  IPC_ERROR_CODES,
  type YashActionDefinition,
} from './types';

export type ActionListEntry = Omit<YashActionDefinition, 'invoke'>;

export type ActionListCondensed = Pick<
  YashActionDefinition,
  'id' | 'title' | 'domain' | 'readOnly' | 'safety' | 'args'
>;

export class IpcActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'IpcActionError';
  }
}

export class ActionRegistry {
  private readonly actions = new Map<string, YashActionDefinition>();

  registerAction(def: YashActionDefinition): void {
    if (this.actions.has(def.id)) {
      throw new Error(`Action "${def.id}" is already registered`);
    }
    this.actions.set(def.id, def);
  }

  overrideAction(def: YashActionDefinition): void {
    this.actions.set(def.id, def);
  }

  getAction(id: string): YashActionDefinition | undefined {
    return this.actions.get(id);
  }

  listActions(options?: {
    ipcOnly?: boolean;
    details?: boolean;
  }): ActionListEntry[] | ActionListCondensed[] {
    let entries = Array.from(this.actions.values());

    if (options?.ipcOnly) {
      entries = entries.filter((a) => a.ipcEnabled);
    }

    if (!options?.details) {
      return entries.map(({ id, title, domain, readOnly, safety, args }) => ({
        id,
        title,
        domain,
        readOnly,
        safety,
        args,
      }));
    }

    return entries.map(({ invoke: _invoke, ...rest }) => rest);
  }

  validateArgs(
    def: YashActionDefinition,
    args: Record<string, unknown>,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [name, schema] of Object.entries(def.args)) {
      const value = args[name];
      const missing = value === undefined || value === null;

      if (schema.required && missing) {
        errors.push(`Missing required arg: ${name}`);
        continue;
      }

      if (missing) continue;

      if (schema.type === 'string') {
        if (typeof value !== 'string') {
          errors.push(`Arg "${name}" must be a string`);
        } else {
          if (schema.minLength !== undefined && value.length < schema.minLength) {
            errors.push(`Arg "${name}" must be at least ${schema.minLength} characters`);
          }
          if (value.length > schema.maxLength) {
            errors.push(`Arg "${name}" must be at most ${schema.maxLength} characters`);
          }
        }
      } else if (schema.type === 'boolean') {
        if (typeof value !== 'boolean') {
          errors.push(`Arg "${name}" must be a boolean`);
        }
      } else if (schema.type === 'number') {
        if (typeof value !== 'number') {
          errors.push(`Arg "${name}" must be a number`);
        } else {
          if (schema.min !== undefined && value < schema.min) {
            errors.push(`Arg "${name}" must be >= ${schema.min}`);
          }
          if (schema.max !== undefined && value > schema.max) {
            errors.push(`Arg "${name}" must be <= ${schema.max}`);
          }
        }
      } else if (schema.type === 'enum') {
        if (!schema.values.includes(String(value))) {
          errors.push(`Arg "${name}" must be one of: ${schema.values.join(', ')}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async invokeAction(
    id: string,
    args: Record<string, unknown>,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    const def = this.actions.get(id);

    if (!def) {
      throw new IpcActionError(IPC_ERROR_CODES.UNKNOWN_ACTION, `Unknown action: ${id}`);
    }

    if (!def.ipcEnabled) {
      throw new IpcActionError(
        IPC_ERROR_CODES.ACTION_UNAVAILABLE,
        `Action "${id}" is not available over IPC`,
      );
    }

    if (def.safety === 'blocked') {
      throw new IpcActionError(IPC_ERROR_CODES.ACTION_BLOCKED, `Action "${id}" is blocked`);
    }

    if (def.safety === 'confirm') {
      throw new IpcActionError(
        IPC_ERROR_CODES.REQUIRES_CONFIRMATION,
        `Action "${id}" requires confirmation before it can be invoked over IPC`,
      );
    }

    const { valid, errors } = this.validateArgs(def, args);
    if (!valid) {
      throw new IpcActionError(IPC_ERROR_CODES.INVALID_ARGS, 'Invalid args', {
        errors,
      });
    }

    return def.invoke(args, ctx);
  }
}

export const registry = new ActionRegistry();
