import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { handleScriptsCommand, renderScriptsHelpLines } from '../src/scripts/commands';
import { listBundledExampleScripts } from '../src/scripts/examples';
import { installBundledExampleScript } from '../src/scripts/install';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('bundled example script helpers', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    await removeRepoTempDir(tempDir);
    tempDir = undefined;
  });

  test('list shows bundled examples as not installed before copying', async () => {
    tempDir = await makeRepoTempDir('yash-scripts-list');

    const scripts = listBundledExampleScripts(tempDir);
    expect(scripts).toHaveLength(2);
    expect(scripts.find((script) => script.id === 'obs-startup')).toMatchObject({
      id: 'obs-startup',
      status: 'not-installed',
    });
    expect(scripts.find((script) => script.id === 'obs-source-recaller')).toMatchObject({
      id: 'obs-source-recaller',
      status: 'not-installed',
    });
  });

  test('install copies all bundled example files into the user script directory', async () => {
    tempDir = await makeRepoTempDir('yash-scripts-install');

    const result = installBundledExampleScript(tempDir, 'obs-startup');
    expect(result.scriptId).toBe('obs-startup');
    expect(result.installedFiles).toHaveLength(3);

    const installedIndex = await fs.readFile(path.join(result.targetDir, 'index.ts'), 'utf8');
    const installedReadme = await fs.readFile(path.join(result.targetDir, 'README.md'), 'utf8');
    const installedConfig = await fs.readFile(path.join(result.targetDir, 'config.jsonc'), 'utf8');

    expect(installedIndex).toContain('export default function setup(api: ScriptApi)');
    expect(installedReadme).toContain('# obs-startup');
    expect(installedConfig).toContain('"prepareScene"');
  });

  test('install aborts without overwriting when any target file already exists', async () => {
    tempDir = await makeRepoTempDir('yash-scripts-conflict');

    const targetDir = path.join(tempDir, 'scripts', 'obs-startup');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'README.md'), 'keep me', 'utf8');

    expect(() => installBundledExampleScript(tempDir!, 'obs-startup')).toThrow(
      'already installed or has conflicting files',
    );

    expect(await fs.readFile(path.join(targetDir, 'README.md'), 'utf8')).toBe('keep me');
    expect(await pathExists(path.join(targetDir, 'index.ts'))).toBe(false);
    expect(await pathExists(path.join(targetDir, 'config.jsonc'))).toBe(false);
  });
});

describe('/scripts command helper', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    await removeRepoTempDir(tempDir);
    tempDir = undefined;
  });

  test('list output includes usage and example status lines', async () => {
    tempDir = await makeRepoTempDir('yash-scripts-command-list');

    const lines = renderScriptsHelpLines(tempDir);
    expect(lines[0]).toBe('[scripts] Bundled example scripts:');
    expect(lines).toContain(
      '[scripts]   obs-startup  — Five-phase OBS startup sequence with countdown and go-live actions. [not installed]',
    );
    expect(lines).toContain(
      '[scripts]   obs-source-recaller  — Per-scene OBS source snapshot saver with automatic scene-change restores. [not installed]',
    );
    expect(lines).toContain(
      '[scripts] Usage: /scripts | /scripts list | /scripts install <example-id>',
    );
  });

  test('install command reports copied files and restart guidance', async () => {
    tempDir = await makeRepoTempDir('yash-scripts-command-install');

    const lines: string[] = [];
    await handleScriptsCommand(
      ['/scripts', 'install', 'obs-startup'],
      (line) => lines.push(line),
      tempDir,
    );

    expect(lines[0]).toBe(
      `[scripts] installed obs-startup into ${path.join(tempDir, 'scripts', 'obs-startup')}`,
    );
    expect(lines.some((line) => line.endsWith('/scripts/obs-startup/index.ts'))).toBe(true);
    expect(lines).toContain('[scripts] Restart yash to load the new script.');
  });

  test('install command reports conflicting files instead of overwriting', async () => {
    tempDir = await makeRepoTempDir('yash-scripts-command-conflict');
    const targetDir = path.join(tempDir, 'scripts', 'obs-startup');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'index.ts'), '// existing', 'utf8');

    const lines: string[] = [];
    await handleScriptsCommand(
      ['/scripts', 'install', 'obs-startup'],
      (line) => lines.push(line),
      tempDir,
    );

    expect(lines[0]).toBe(
      '[scripts] Bundled example script "obs-startup" is already installed or has conflicting files',
    );
    expect(lines[1]).toBe(`[scripts]   ${path.join(targetDir, 'index.ts')}`);
    expect(await fs.readFile(path.join(targetDir, 'index.ts'), 'utf8')).toBe('// existing');
  });
});
