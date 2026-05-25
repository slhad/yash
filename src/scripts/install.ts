import * as fs from 'node:fs';
import * as path from 'node:path';
import { deepMerge } from '../utils/settings';
import {
  getBundledExampleScriptDefinition,
  getBundledExampleScriptTargetDir,
  resolveBundledExampleScriptSourceDir,
} from './examples';

export class BundledExampleScriptInstallError extends Error {
  readonly code: 'UNKNOWN_SCRIPT' | 'SOURCE_MISSING' | 'TARGET_EXISTS' | 'TARGET_CONFIG_INVALID';
  readonly details: string[];

  constructor(
    code: 'UNKNOWN_SCRIPT' | 'SOURCE_MISSING' | 'TARGET_EXISTS' | 'TARGET_CONFIG_INVALID',
    message: string,
    details: string[] = [],
  ) {
    super(message);
    this.name = 'BundledExampleScriptInstallError';
    this.code = code;
    this.details = details;
  }
}

export type BundledExampleScriptInstallResult = {
  scriptId: string;
  targetDir: string;
  installedFiles: string[];
  warnings: string[];
  mode: 'install' | 'repair';
};

type InstallBundledExampleScriptOptions = {
  force?: boolean;
};

function parseJsonc(text: string): unknown {
  let result = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    if (inString) {
      if (text[i] === '\\') {
        result += text[i] + (text[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (text[i] === '"') inString = false;
      result += text[i++];
    } else if (text[i] === '"') {
      inString = true;
      result += text[i++];
    } else if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      result += text[i++];
    }
  }

  result = result.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(result);
}

function readJsoncObject(filePath: string): Record<string, unknown> {
  const parsed = parseJsonc(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${filePath} does not contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function installBundledExampleScript(
  dataDir: string,
  scriptId: string,
  options: InstallBundledExampleScriptOptions = {},
): BundledExampleScriptInstallResult {
  const script = getBundledExampleScriptDefinition(scriptId);
  if (!script) {
    throw new BundledExampleScriptInstallError(
      'UNKNOWN_SCRIPT',
      `Unknown bundled example script: ${scriptId}`,
    );
  }

  const sourceDir = resolveBundledExampleScriptSourceDir(script);
  const targetDir = getBundledExampleScriptTargetDir(dataDir, script.id);
  const missingSources = script.files
    .map((file) => path.join(sourceDir, file))
    .filter((filePath) => !fs.existsSync(filePath));

  if (missingSources.length > 0) {
    throw new BundledExampleScriptInstallError(
      'SOURCE_MISSING',
      `Bundled example script "${script.id}" is missing required files`,
      missingSources,
    );
  }

  const conflicts = script.files
    .map((file) => path.join(targetDir, file))
    .filter((filePath) => fs.existsSync(filePath));

  if (conflicts.length > 0 && !options.force) {
    throw new BundledExampleScriptInstallError(
      'TARGET_EXISTS',
      `Bundled example script "${script.id}" is already installed or has conflicting files`,
      conflicts,
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const installedFiles: string[] = [];
  const warnings: string[] = [];
  for (const file of script.files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    if (file === 'config.jsonc' && options.force && fs.existsSync(targetPath)) {
      try {
        const sourceConfig = readJsoncObject(sourcePath);
        const targetConfig = readJsoncObject(targetPath);
        const mergedConfig = deepMerge(sourceConfig, targetConfig);
        fs.writeFileSync(`${targetPath}.bak`, fs.readFileSync(targetPath, 'utf8'), 'utf8');
        fs.writeFileSync(`${targetPath}.new`, fs.readFileSync(sourcePath, 'utf8'), 'utf8');
        fs.writeFileSync(targetPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
        warnings.push(
          `merged config.jsonc with current values preserved; backups written as ${targetPath}.bak and ${targetPath}.new`,
        );
      } catch (error) {
        throw new BundledExampleScriptInstallError(
          'TARGET_CONFIG_INVALID',
          `Cannot repair "${script.id}" because ${targetPath} is not valid JSONC`,
          [String(error)],
        );
      }
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
    installedFiles.push(targetPath);
  }

  return {
    scriptId: script.id,
    targetDir,
    installedFiles,
    warnings,
    mode: options.force ? 'repair' : 'install',
  };
}
