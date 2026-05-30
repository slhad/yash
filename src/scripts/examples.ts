import * as fs from 'node:fs';
import * as path from 'node:path';

export type BundledExampleScriptDefinition = {
  id: string;
  name: string;
  description: string;
  relativeDir: string;
  files: readonly string[];
};

export type BundledExampleScriptStatus = 'not-installed' | 'partial' | 'installed';

export type BundledExampleScriptEntry = BundledExampleScriptDefinition & {
  sourceDir: string;
  targetDir: string;
  status: BundledExampleScriptStatus;
  installedFiles: string[];
  missingFiles: string[];
};

const EXAMPLES_ROOT = path.resolve(import.meta.dir, '../../examples/scripts');

const BUNDLED_EXAMPLE_SCRIPTS: readonly BundledExampleScriptDefinition[] = [
  {
    id: 'obs-startup',
    name: 'OBS startup',
    description: 'Five-phase OBS startup sequence with countdown and go-live actions.',
    relativeDir: 'obs-startup',
    files: ['README.md', 'config.jsonc', 'config.ts', 'index.ts', 'types.d.ts'],
  },
  {
    id: 'obs-source-recaller',
    name: 'OBS source recaller',
    description: 'Per-scene OBS source snapshot saver with automatic scene-change restores.',
    relativeDir: 'obs-source-recaller',
    files: ['README.md', 'config.jsonc', 'index.ts', 'types.d.ts'],
  },
] as const;

export const BUNDLED_EXAMPLE_SCRIPT_IDS = BUNDLED_EXAMPLE_SCRIPTS.map((script) => script.id);

export function getBundledExampleScriptsRoot(): string {
  return EXAMPLES_ROOT;
}

export function getBundledExampleScriptDefinition(
  id: string,
): BundledExampleScriptDefinition | undefined {
  return BUNDLED_EXAMPLE_SCRIPTS.find((script) => script.id === id);
}

export function getBundledExampleScriptTargetDir(dataDir: string, scriptId: string): string {
  return path.join(dataDir, 'scripts', scriptId);
}

export function resolveBundledExampleScriptSourceDir(
  script: BundledExampleScriptDefinition,
): string {
  return path.join(EXAMPLES_ROOT, script.relativeDir);
}

export function listBundledExampleScripts(dataDir: string): BundledExampleScriptEntry[] {
  return BUNDLED_EXAMPLE_SCRIPTS.map((script) => {
    const sourceDir = resolveBundledExampleScriptSourceDir(script);
    const targetDir = getBundledExampleScriptTargetDir(dataDir, script.id);
    const installedFiles = script.files.filter((file) => fs.existsSync(path.join(targetDir, file)));
    const missingFiles = script.files.filter((file) => !installedFiles.includes(file));
    const status =
      installedFiles.length === 0
        ? 'not-installed'
        : missingFiles.length === 0
          ? 'installed'
          : 'partial';

    return {
      ...script,
      sourceDir,
      targetDir,
      status,
      installedFiles,
      missingFiles,
    };
  });
}
