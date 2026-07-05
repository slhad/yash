import { describe, expect, test } from 'bun:test';
import {
  buildScriptConfigTemplateContext,
  inferScriptConfigValueType,
  parseScriptConfigScalarValue,
  renderScriptConfigTemplate,
  scriptConfigPathKey,
} from '../src/ui/scriptConfigModal';

describe('script config modal helpers', () => {
  test('builds slash-separated config path keys', () => {
    expect(scriptConfigPathKey(['rules', 2, 'enabled'])).toBe('rules/2/enabled');
  });

  test('infers scalar value types', () => {
    expect(inferScriptConfigValueType('hello')).toBe('text');
    expect(inferScriptConfigValueType(1)).toBe('number');
    expect(inferScriptConfigValueType(false)).toBe('boolean');
    expect(inferScriptConfigValueType(null)).toBe('null');
  });

  test('renders schema templates from object and array context', () => {
    const context = buildScriptConfigTemplateContext(['routes', 1], {
      name: 'Music',
      enabled: true,
    });

    expect(context).toMatchObject({
      key: '1',
      path: 'routes/1',
      index: 1,
      type: 'object',
      length: 2,
      name: 'Music',
      enabled: true,
    });
    expect(renderScriptConfigTemplate('Route $' + '{index}: $' + '{name}', context)).toBe(
      'Route 1: Music',
    );
  });

  test('parses scalar edits according to original value type', () => {
    expect(parseScriptConfigScalarValue('toggle', false, 'Enabled', true)).toBe(true);
    expect(parseScriptConfigScalarValue('text', 3, 'Count', ' 4 ')).toBe(4);
    expect(parseScriptConfigScalarValue('text', null, 'Optional', 'null')).toBe(null);
    expect(parseScriptConfigScalarValue('text', 'old', 'Label', 'new')).toBe('new');
    expect(() => parseScriptConfigScalarValue('text', 3, 'Count', 'nope')).toThrow(
      'Count must be a valid number',
    );
  });
});
