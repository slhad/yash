import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  TextRenderable,
} from '@opentui/core';
import type { ScriptConfigModalField, ScriptConfigModalSpec } from '../actions/types';
import type { ChatLine } from './tuiChatLines';

export type ScriptConfigModalState = {
  box: BoxRenderable;
  focusIndex: number;
};

export type ScriptConfigModalContext = {
  renderer: CliRenderer;
  hasBlockingModal: () => boolean;
  getActiveModal: () => ScriptConfigModalState | null;
  setActiveModal: (modal: ScriptConfigModalState | null) => void;
  lastMessages: ChatLine[];
  updateUI: (messages: ChatLine[]) => void;
  focusMainInput: () => void;
  createIndentedInputRow: (
    renderer: CliRenderer,
    input: InputRenderable,
    indent?: string,
  ) => BoxRenderable;
};

export type ScriptConfigPathSegment = string | number;
export type ScriptConfigValueType = 'text' | 'number' | 'boolean' | 'null';

function isScriptConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function scriptConfigPathKey(segments: ScriptConfigPathSegment[]): string {
  return segments.map((segment) => String(segment)).join('/');
}

export function inferScriptConfigValueType(value: unknown): ScriptConfigValueType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null) return 'null';
  return 'text';
}

export function buildScriptConfigTemplateContext(
  segments: ScriptConfigPathSegment[],
  value: unknown,
): Record<string, string | number | boolean> {
  const lastSegment = segments[segments.length - 1];
  const context: Record<string, string | number | boolean> = {
    key: String(lastSegment ?? ''),
    path: scriptConfigPathKey(segments),
    index: typeof lastSegment === 'number' ? lastSegment : '',
    type: Array.isArray(value)
      ? 'array'
      : isScriptConfigRecord(value)
        ? 'object'
        : inferScriptConfigValueType(value),
    length: Array.isArray(value)
      ? value.length
      : isScriptConfigRecord(value)
        ? Object.keys(value).length
        : 0,
  };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    context.value = value;
  }
  if (isScriptConfigRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
        context[key] = child;
      }
    }
  }
  return context;
}

export function renderScriptConfigTemplate(
  template: string | undefined,
  context: Record<string, string | number | boolean>,
): string | undefined {
  if (!template) return undefined;
  return template.replaceAll(/\$\{([^}]+)\}/g, (_match, rawKey) => {
    const key = String(rawKey).trim();
    return String(context[key] ?? '');
  });
}

export function parseScriptConfigScalarValue(
  kind: 'text' | 'toggle',
  originalValue: unknown,
  label: string,
  rawValue: unknown,
): unknown {
  if (kind === 'toggle') return Boolean(rawValue);
  if (typeof originalValue === 'number') {
    const num = Number(String(rawValue ?? '').trim());
    if (!Number.isFinite(num)) {
      throw new Error(`${label} must be a valid number`);
    }
    return num;
  }
  if (originalValue === null) {
    const text = String(rawValue ?? '').trim();
    return text === 'null' ? null : text;
  }
  return String(rawValue ?? '');
}

export function openScriptConfigModal(
  ctx: ScriptConfigModalContext,
  spec: ScriptConfigModalSpec,
): void {
  if (ctx.hasBlockingModal()) return;

  const { renderer, lastMessages, updateUI } = ctx;
  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '7%',
    left: '6%',
    width: '88%',
    height: '84%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ` ${spec.title} `,
  });

  const contentScroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: false,
    stickyStart: 'top',
    scrollX: false,
    scrollY: true,
  });
  const contentBox = new BoxRenderable(renderer, {
    flexDirection: 'column',
    gap: 0,
    width: '100%',
  });

  const introNode = new TextRenderable(renderer, { content: spec.intro, fg: 'gray' });
  const configSummaryNode = new TextRenderable(renderer, { content: '', fg: 'gray' });
  const hierarchyLegendNode = new TextRenderable(renderer, {
    content:
      ' Structure: sectionName {} object, sectionName [] array, • array item. Indentation shows nesting; focus an array item to show move/delete controls.',
    fg: 'gray',
  });
  box.add(introNode);
  box.add(configSummaryNode);
  box.add(hierarchyLegendNode);
  box.add(new TextRenderable(renderer, { content: '', fg: 'gray' }));
  contentScroll.add(contentBox);
  box.add(contentScroll);

  const isRecord = isScriptConfigRecord;
  const cloneValue = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const clearBox = (target: BoxRenderable): void => {
    for (const child of target.getChildren()) {
      target.remove(child.id);
    }
  };
  const UI_SCHEMA_KEY = '$ui';
  const isObjectConfigSpec = 'config' in spec;
  const draftConfig = isObjectConfigSpec ? cloneValue(spec.config) : null;
  type PathSegment = ScriptConfigPathSegment;
  type ResolvedConfigField =
    | (Extract<ScriptConfigModalField, { kind: 'text' | 'toggle' }> & {
        pathSegments: PathSegment[];
        originalValue: unknown;
        depth: number;
        valueType: ScriptConfigValueType;
        helpText?: string;
      })
    | {
        key: string;
        kind: 'section';
        pathSegments: PathSegment[];
        label: string;
        description?: string;
        depth: number;
        nodeType: 'array' | 'object';
        editableArrayItem: boolean;
      };
  const pathKey = scriptConfigPathKey;
  const splitSchemaPath = (schemaPath: string): string[] => schemaPath.split('/').filter(Boolean);
  const matchesSchemaPath = (schemaPath: string, segments: PathSegment[]): boolean => {
    const parts = splitSchemaPath(schemaPath);
    if (parts.length !== segments.length) return false;
    return parts.every((part, index) => part === '*' || part === String(segments[index]));
  };
  const schemaSpecificity = (schemaPath: string): number => {
    const parts = splitSchemaPath(schemaPath);
    return parts.reduce((score, part) => score + (part === '*' ? 0 : 2), 0) + parts.length;
  };
  const inferValueType = inferScriptConfigValueType;
  const buildTemplateContext = buildScriptConfigTemplateContext;
  const renderTemplate = renderScriptConfigTemplate;
  const getValueAtSegments = (data: unknown, segments: PathSegment[]): unknown => {
    let current = data;
    for (const segment of segments) {
      if (Array.isArray(current) && typeof segment === 'number') {
        current = current[segment];
        continue;
      }
      if (isRecord(current) && typeof segment === 'string' && segment in current) {
        current = current[segment];
        continue;
      }
      return undefined;
    }
    return current;
  };
  const setValueAtSegments = (
    data: Record<string, unknown>,
    segments: PathSegment[],
    value: unknown,
  ): void => {
    if (segments.length === 0) {
      throw new Error('config path required');
    }
    let current: unknown = data;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i] as PathSegment;
      const nextSegment = segments[i + 1] as PathSegment;
      if (typeof segment === 'number') {
        if (!Array.isArray(current)) {
          throw new Error(`invalid array path at ${pathKey(segments.slice(0, i + 1))}`);
        }
        if (current[segment] === undefined) {
          current[segment] = typeof nextSegment === 'number' ? [] : {};
        }
        current = current[segment];
        continue;
      }
      if (!isRecord(current)) {
        throw new Error(`invalid object path at ${pathKey(segments.slice(0, i + 1))}`);
      }
      const nextValue = current[segment];
      if (nextValue === undefined) {
        current[segment] = typeof nextSegment === 'number' ? [] : {};
      }
      current = current[segment];
    }
    const lastSegment = segments[segments.length - 1] as PathSegment;
    if (typeof lastSegment === 'number') {
      if (!Array.isArray(current)) {
        throw new Error(`invalid array path at ${pathKey(segments)}`);
      }
      current[lastSegment] = cloneValue(value);
      return;
    }
    if (!isRecord(current)) {
      throw new Error(`invalid object path at ${pathKey(segments)}`);
    }
    current[lastSegment] = cloneValue(value);
  };
  const moveArrayValue = (
    data: Record<string, unknown>,
    segments: PathSegment[],
    direction: -1 | 1,
  ): PathSegment[] | null => {
    if (segments.length === 0) return null;
    const currentIndex = segments[segments.length - 1];
    if (typeof currentIndex !== 'number') return null;
    const parent = getValueAtSegments(data, segments.slice(0, -1));
    if (!Array.isArray(parent)) return null;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= parent.length) return null;
    const currentValue = parent[currentIndex];
    parent[currentIndex] = parent[nextIndex];
    parent[nextIndex] = currentValue;
    return [...segments.slice(0, -1), nextIndex];
  };
  const deleteArrayValue = (
    data: Record<string, unknown>,
    segments: PathSegment[],
  ): PathSegment[] | null => {
    if (segments.length === 0) return null;
    const currentIndex = segments[segments.length - 1];
    if (typeof currentIndex !== 'number') return null;
    const parentPath = segments.slice(0, -1);
    const parent = getValueAtSegments(data, parentPath);
    if (!Array.isArray(parent)) return null;
    parent.splice(currentIndex, 1);
    if (parent.length === 0) return parentPath.length > 0 ? parentPath : null;
    return [...parentPath, Math.min(currentIndex, parent.length - 1)];
  };

  const buildResolvedFields = (configSource: Record<string, unknown>): ResolvedConfigField[] => {
    if (!isObjectConfigSpec) {
      return spec.fields.map((field) => ({
        ...field,
        pathSegments: [field.key],
        originalValue: field.kind === 'toggle' ? field.value : field.value,
        depth: 0,
        valueType: field.kind === 'toggle' ? 'boolean' : 'text',
        helpText: field.description,
      }));
    }

    const config = cloneValue(configSource);
    const rawSchema = isRecord(config[UI_SCHEMA_KEY]) ? config[UI_SCHEMA_KEY] : {};
    const schema = rawSchema as Record<
      string,
      {
        label?: string;
        description?: string;
        titleTemplate?: string;
        labelTemplate?: string;
        descriptionTemplate?: string;
        widget?: 'auto' | 'text' | 'toggle' | 'json';
        hidden?: boolean;
        placeholder?: string;
        order?: number;
      }
    >;
    const schemaEntries = Object.entries(schema).sort(
      ([leftPath], [rightPath]) => schemaSpecificity(rightPath) - schemaSpecificity(leftPath),
    );
    const resolvedFields: Array<ResolvedConfigField & { order: number }> = [];
    const resolveMeta = (segments: PathSegment[]) => {
      const exact = schema[pathKey(segments)];
      if (exact) return exact;
      return (
        schemaEntries.find(([schemaPath]) => matchesSchemaPath(schemaPath, segments))?.[1] ?? {}
      );
    };
    const pushScalarField = (
      segments: PathSegment[],
      value: unknown,
      depth: number,
      meta: (typeof schema)[string],
    ) => {
      if (meta.hidden) return;
      const key = pathKey(segments);
      const labelBase = String(segments[segments.length - 1] ?? key);
      const valueType = inferValueType(value);
      const context = buildTemplateContext(segments, value);
      const label = renderTemplate(meta.labelTemplate, context) ?? meta.label ?? labelBase;
      const helpText = renderTemplate(meta.descriptionTemplate, context) ?? meta.description;
      if (meta.widget === 'toggle' || (meta.widget !== 'text' && typeof value === 'boolean')) {
        resolvedFields.push({
          key,
          kind: 'toggle',
          label,
          description: helpText ?? 'boolean',
          value: Boolean(value),
          pathSegments: segments,
          originalValue: value,
          depth,
          valueType,
          helpText,
          order: meta.order ?? Number.MAX_SAFE_INTEGER,
        });
        return;
      }
      resolvedFields.push({
        key,
        kind: 'text',
        label,
        description: valueType,
        value: value === null ? 'null' : String(value ?? ''),
        placeholder: meta.placeholder,
        pathSegments: segments,
        originalValue: value,
        depth,
        valueType,
        helpText,
        order: meta.order ?? Number.MAX_SAFE_INTEGER,
      });
    };
    const sortConfigEntries = (
      entries: Array<[string, unknown]>,
      parentSegments: PathSegment[],
    ): Array<[string, unknown]> =>
      entries.sort(([leftKey], [rightKey]) => {
        const leftMeta = resolveMeta([...parentSegments, leftKey]);
        const rightMeta = resolveMeta([...parentSegments, rightKey]);
        const leftOrder = leftMeta.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = rightMeta.order ?? Number.MAX_SAFE_INTEGER;
        return leftOrder === rightOrder ? leftKey.localeCompare(rightKey) : leftOrder - rightOrder;
      });

    const walkConfig = (value: unknown, segments: PathSegment[], depth: number): void => {
      const meta = resolveMeta(segments);
      if (segments.length > 0 && !meta.hidden && (Array.isArray(value) || isRecord(value))) {
        const context = buildTemplateContext(segments, value);
        const renderedTitle = renderTemplate(meta.titleTemplate, context);
        const renderedLabel =
          renderTemplate(meta.labelTemplate, context) ??
          meta.label ??
          String(segments[segments.length - 1]);
        const renderedDescription =
          renderTemplate(meta.descriptionTemplate, context) ??
          meta.description ??
          (Array.isArray(value) ? `${value.length} item(s)` : 'object');
        resolvedFields.push({
          key: pathKey(segments),
          kind: 'section',
          pathSegments: segments,
          label: renderedTitle ?? renderedLabel,
          description: renderedTitle ? undefined : renderedDescription,
          depth,
          nodeType: Array.isArray(value) ? 'array' : 'object',
          editableArrayItem:
            typeof segments[segments.length - 1] === 'number' &&
            (Array.isArray(value) || isRecord(value)),
          order: meta.order ?? Number.MAX_SAFE_INTEGER,
        });
      }
      if (Array.isArray(value)) {
        value.forEach((entry, index) => walkConfig(entry, [...segments, index], depth + 1));
        return;
      }
      if (isRecord(value)) {
        const entries = sortConfigEntries(
          Object.entries(value).filter(
            ([key]) => !(segments.length === 0 && key === UI_SCHEMA_KEY),
          ),
          segments,
        );
        for (const [key, child] of entries) {
          walkConfig(child, [...segments, key], depth + 1);
        }
        return;
      }
      pushScalarField(segments, value, depth, meta);
    };
    for (const [key, value] of sortConfigEntries(
      Object.entries(config).filter(([key]) => key !== UI_SCHEMA_KEY),
      [],
    )) {
      walkConfig(value, [key], 0);
    }

    return resolvedFields.map(({ order: _order, ...field }) => field);
  };

  type ScriptConfigFocusItem =
    | {
        field: Extract<ResolvedConfigField, { kind: 'text' }>;
        kind: 'input';
        node: InputRenderable;
        container: BoxRenderable;
        prefixNode: TextRenderable;
        markerNode: TextRenderable;
      }
    | {
        field: Extract<ResolvedConfigField, { kind: 'toggle' }>;
        kind: 'toggle';
        node: TextRenderable;
        container: TextRenderable;
      }
    | {
        field: Extract<ResolvedConfigField, { kind: 'section' }>;
        kind: 'section';
        node: TextRenderable;
        container: TextRenderable;
      };

  let resolvedFields = buildResolvedFields(draftConfig ?? {});
  let items: ScriptConfigFocusItem[] = [];
  const rawValues: Record<string, unknown> = {};
  const maxVisualDepth = 6;
  const treeIndent = (depth: number): string => '  '.repeat(Math.min(depth, maxVisualDepth));
  const scalarBranch = (_depth: number): string => '';
  const sectionMarker = (nodeType: 'array' | 'object'): string =>
    nodeType === 'array' ? '[]' : '{}';
  renderer.root.add(box);
  let focusIdx = 0;
  ctx.setActiveModal({ box, focusIndex: 0 });
  const scalarColor = (valueType: 'text' | 'number' | 'boolean' | 'null'): string => {
    if (valueType === 'boolean') return 'green';
    if (valueType === 'number') return 'yellow';
    if (valueType === 'null') return 'gray';
    return 'white';
  };
  const sectionColor = (nodeType: 'array' | 'object'): string =>
    nodeType === 'array' ? 'cyan' : 'magenta';

  function parseScalarValue(
    field: Extract<ResolvedConfigField, { kind: 'text' | 'toggle' }>,
    rawValue: unknown,
  ): unknown {
    return parseScriptConfigScalarValue(field.kind, field.originalValue, field.label, rawValue);
  }

  function syncDraftFromInputs(): { errors: string[] } {
    const errors: string[] = [];
    if (!isObjectConfigSpec || !draftConfig) return { errors };
    for (const item of items) {
      if (item.kind === 'section') continue;
      const rawValue = item.kind === 'input' ? item.node.value : rawValues[item.field.key];
      try {
        const parsedValue = parseScalarValue(item.field, rawValue);
        setValueAtSegments(draftConfig, item.field.pathSegments, parsedValue);
        rawValues[item.field.key] = parsedValue;
      } catch (error) {
        errors.push(String(error instanceof Error ? error.message : error));
      }
    }
    return { errors };
  }

  function updateConfigSummary(): void {
    if (!isObjectConfigSpec || !draftConfig) {
      configSummaryNode.content = '';
      configSummaryNode.fg = 'gray';
      return;
    }
    const rootEnabled =
      typeof rawValues.enabled === 'boolean'
        ? rawValues.enabled
        : getValueAtSegments(draftConfig, ['enabled']);
    if (rootEnabled === false) {
      configSummaryNode.content =
        ' Status: ROOT enabled = OFF — nested ON values are saved, but OBS audio routing will not run until this is enabled.';
      configSummaryNode.fg = 'yellow';
      return;
    }
    if (rootEnabled === true) {
      configSummaryNode.content =
        ' Status: ROOT enabled = ON — nested discovery, feedback, routing, and OBS-streaming rules are active according to their own toggles.';
      configSummaryNode.fg = 'green';
      return;
    }
    configSummaryNode.content =
      ' Status: edit nested sections below; Enter saves all changes, Esc cancels.';
    configSummaryNode.fg = 'gray';
  }

  function renderSection(
    item: Extract<ScriptConfigFocusItem, { kind: 'section' }>,
    focused: boolean,
  ): void {
    const actionsHint =
      item.field.editableArrayItem && focused
        ? '  controls: [ move up | ] move down | x delete'
        : '';
    const marker = sectionMarker(item.field.nodeType);
    const branch = item.field.editableArrayItem ? '•' : '▾';
    const description =
      item.field.description && item.field.description !== item.field.nodeType
        ? `  - ${item.field.description}`
        : '';
    item.node.content = `${focused ? '>' : ' '} ${treeIndent(item.field.depth)}${branch} ${item.field.label} ${marker}${description}${actionsHint}`;
    item.node.fg = focused ? 'cyan' : sectionColor(item.field.nodeType);
    item.node.attributes = focused || item.field.depth === 0 ? TextAttributes.BOLD : 0;
  }

  function renderToggle(
    item: Extract<ScriptConfigFocusItem, { kind: 'toggle' }>,
    focused: boolean,
  ): void {
    const value = Boolean(rawValues[item.field.key]);
    const state = value ? 'ON ' : 'OFF';
    item.node.content = `${focused ? '>' : ' '} ${`${treeIndent(item.field.depth)}${scalarBranch(item.field.depth)}${item.field.label}: ${item.field.valueType} = `.padEnd(scalarPrefixWidth)}${state}${item.field.helpText ? `  - ${item.field.helpText}` : ''}`;
    item.node.fg = focused ? 'cyan' : scalarColor(item.field.valueType);
    if (item.field.depth === 0 && item.field.label === 'enabled') {
      item.node.attributes = TextAttributes.BOLD;
    } else {
      item.node.attributes = focused ? TextAttributes.BOLD : 0;
    }
    updateConfigSummary();
  }

  let scalarPrefixWidth = 0;
  function escapeViaKeyDown(key: { name: string }): void {
    if (key.name === 'escape' && ctx.getActiveModal()) cancelAndClose();
  }

  function renderFields(focusPath?: string): void {
    clearBox(contentBox);
    items = [];
    for (const key of Object.keys(rawValues)) delete rawValues[key];
    resolvedFields = buildResolvedFields(draftConfig ?? {});
    scalarPrefixWidth = resolvedFields
      .filter(
        (field): field is Extract<ResolvedConfigField, { kind: 'text' | 'toggle' }> =>
          field.kind === 'text' || field.kind === 'toggle',
      )
      .reduce((maxWidth, field) => {
        const prefix = `${treeIndent(field.depth)}${scalarBranch(field.depth)}${field.label}: ${field.valueType} = `;
        return Math.max(maxWidth, prefix.length);
      }, 0);

    for (const field of resolvedFields) {
      if (field.kind === 'section') {
        const row = new TextRenderable(renderer, { content: '', fg: sectionColor(field.nodeType) });
        if (field.depth === 0 && contentBox.getChildren().length > 0) {
          contentBox.add(new TextRenderable(renderer, { content: '', fg: 'gray' }));
        }
        contentBox.add(row);
        if (field.editableArrayItem) {
          items.push({ field, kind: 'section', node: row, container: row });
        } else {
          renderSection({ field, kind: 'section', node: row, container: row }, false);
        }
        continue;
      }
      if (field.kind === 'toggle') {
        const row = new TextRenderable(renderer, { content: '', fg: scalarColor(field.valueType) });
        rawValues[field.key] = field.value;
        contentBox.add(row);
        items.push({ field, kind: 'toggle', node: row, container: row });
        continue;
      }
      const fieldRow = new BoxRenderable(renderer, {
        width: '100%',
        flexDirection: 'row',
        gap: 0,
      });
      const markerNode = new TextRenderable(renderer, {
        content: '  ',
        fg: scalarColor(field.valueType),
      });
      fieldRow.add(markerNode);
      const indent = treeIndent(field.depth);
      if (indent.length > 0) {
        fieldRow.add(
          new TextRenderable(renderer, { content: indent, fg: scalarColor(field.valueType) }),
        );
      }
      const prefixNode = new TextRenderable(renderer, {
        content: `${scalarBranch(field.depth)}${field.label}: ${field.valueType} = `.padEnd(
          Math.max(1, scalarPrefixWidth - indent.length),
        ),
        fg: scalarColor(field.valueType),
      });
      fieldRow.add(prefixNode);
      const inputBox = new BoxRenderable(renderer, {
        flexDirection: 'column',
        flexGrow: 1,
      });
      const input = new InputRenderable(renderer, {
        placeholder: field.placeholder ?? '',
        width: '100%',
      });
      input.value = field.value;
      rawValues[field.key] = field.value;
      inputBox.add(input);
      fieldRow.add(inputBox);
      contentBox.add(fieldRow);
      items.push({
        field,
        kind: 'input',
        node: input,
        container: fieldRow,
        prefixNode,
        markerNode,
      });
    }

    if (items.length === 0) {
      focusIdx = 0;
      return;
    }
    if (focusPath) {
      const matchedIndex = items.findIndex(
        (item) => pathKey(item.field.pathSegments) === focusPath,
      );
      focusIdx = matchedIndex >= 0 ? matchedIndex : Math.min(focusIdx, items.length - 1);
    } else {
      focusIdx = Math.min(focusIdx, items.length - 1);
    }
    for (const item of items) {
      if (item.kind === 'toggle') renderToggle(item, false);
      else if (item.kind === 'section') renderSection(item, false);
      else item.node.onKeyDown = escapeViaKeyDown as any;
    }
  }

  function blurCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') {
      current.node.blur();
      current.markerNode.content = '  ';
      current.markerNode.fg = scalarColor(current.field.valueType);
      current.prefixNode.fg = scalarColor(current.field.valueType);
    } else if (current.kind === 'toggle') renderToggle(current, false);
    else renderSection(current, false);
  }

  function scrollCurrentIntoView(): void {
    const current = items[focusIdx];
    if (!current) return;
    contentScroll.scrollChildIntoView(current.container.id);
  }

  function focusCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') {
      current.node.focus();
      current.markerNode.content = '> ';
      current.markerNode.fg = 'cyan';
      current.prefixNode.fg = 'cyan';
    } else if (current.kind === 'toggle') {
      renderToggle(current, true);
    } else {
      renderSection(current, true);
    }
    scrollCurrentIntoView();
  }

  renderFields();
  focusCurrent();

  async function saveAndClose(): Promise<void> {
    let result: { changedKeys: string[]; errors?: string[] };
    if (isObjectConfigSpec) {
      const { errors } = syncDraftFromInputs();
      if (errors.length > 0) {
        for (const error of errors) lastMessages.push(`${spec.prefix} ${error}`);
        updateUI(lastMessages);
        return;
      }
      result = await spec.onSaveConfig(cloneValue(draftConfig as Record<string, unknown>));
    } else {
      for (const item of items) {
        if (item.kind === 'input') rawValues[item.field.key] = item.node.value;
      }
      result = await spec.onSave(rawValues);
    }
    if (result.errors && result.errors.length > 0) {
      for (const error of result.errors) lastMessages.push(`${spec.prefix} ${error}`);
      updateUI(lastMessages);
      return;
    }

    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();
    lastMessages.push(
      result.changedKeys.length > 0
        ? `${spec.prefix} Updated: ${result.changedKeys.join(', ')}`
        : `${spec.prefix} No changes.`,
    );
    updateUI(lastMessages);
  }

  function cancelAndClose(): void {
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    const activeModal = ctx.getActiveModal();
    if (!activeModal) return false;
    const current = items[focusIdx];
    if (!current) return false;

    if (sequence === '\t' || sequence === '\x1b[Z') {
      blurCurrent();
      focusIdx = (focusIdx + (sequence === '\t' ? 1 : -1) + items.length) % items.length;
      activeModal.focusIndex = focusIdx;
      focusCurrent();
      return true;
    }

    if (
      current.kind === 'section' &&
      current.field.editableArrayItem &&
      isObjectConfigSpec &&
      draftConfig
    ) {
      if (sequence === '[' || sequence === '\x1b[1;3A' || sequence === '\x1bk') {
        const { errors } = syncDraftFromInputs();
        if (errors.length > 0) {
          for (const error of errors) lastMessages.push(`${spec.prefix} ${error}`);
          updateUI(lastMessages);
          return true;
        }
        const nextPath = moveArrayValue(draftConfig, current.field.pathSegments, -1);
        if (nextPath) {
          renderFields(pathKey(nextPath));
          focusCurrent();
        }
        return true;
      }
      if (sequence === ']' || sequence === '\x1b[1;3B' || sequence === '\x1bj') {
        const { errors } = syncDraftFromInputs();
        if (errors.length > 0) {
          for (const error of errors) lastMessages.push(`${spec.prefix} ${error}`);
          updateUI(lastMessages);
          return true;
        }
        const nextPath = moveArrayValue(draftConfig, current.field.pathSegments, 1);
        if (nextPath) {
          renderFields(pathKey(nextPath));
          focusCurrent();
        }
        return true;
      }
      if (sequence === 'x' || sequence === '\x7f' || sequence === '\x1b[3~') {
        const { errors } = syncDraftFromInputs();
        if (errors.length > 0) {
          for (const error of errors) lastMessages.push(`${spec.prefix} ${error}`);
          updateUI(lastMessages);
          return true;
        }
        const nextPath = deleteArrayValue(draftConfig, current.field.pathSegments);
        renderFields(nextPath ? pathKey(nextPath) : undefined);
        focusCurrent();
        return true;
      }
    }

    if (
      current.kind === 'toggle' &&
      (sequence === ' ' || sequence === '\x1b[C' || sequence === '\x1b[D')
    ) {
      rawValues[current.field.key] = !rawValues[current.field.key];
      renderToggle(current, true);
      updateConfigSummary();
      return true;
    }

    if (sequence === '\r' || sequence === '\n') {
      void saveAndClose();
      return true;
    }
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      cancelAndClose();
      return true;
    }
    if (sequence === '\x1b[A') {
      contentScroll.scrollBy(-1);
      return true;
    }
    if (sequence === '\x1b[B') {
      contentScroll.scrollBy(1);
      return true;
    }
    if (sequence === '\x1b[5~') {
      contentScroll.scrollBy(-0.5, 'viewport');
      return true;
    }
    if (sequence === '\x1b[6~') {
      contentScroll.scrollBy(0.5, 'viewport');
      return true;
    }
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);
}
