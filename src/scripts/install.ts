import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getBundledExampleScriptDefinition,
  getBundledExampleScriptTargetDir,
  resolveBundledExampleScriptSourceDir,
} from './examples';

export class BundledExampleScriptInstallError extends Error {
  readonly code: 'UNKNOWN_SCRIPT' | 'SOURCE_MISSING' | 'TARGET_EXISTS';
  readonly details: string[];

  constructor(
    code: 'UNKNOWN_SCRIPT' | 'SOURCE_MISSING' | 'TARGET_EXISTS',
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
};

export function installBundledExampleScript(
  dataDir: string,
  scriptId: string,
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

  if (conflicts.length > 0) {
    throw new BundledExampleScriptInstallError(
      'TARGET_EXISTS',
      `Bundled example script "${script.id}" is already installed or has conflicting files`,
      conflicts,
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const installedFiles: string[] = [];
  for (const file of script.files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    fs.copyFileSync(sourcePath, targetPath);
    installedFiles.push(targetPath);
  }

  return {
    scriptId: script.id,
    targetDir,
    installedFiles,
  };
}
