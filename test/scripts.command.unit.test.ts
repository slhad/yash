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
    expect(scripts).toHaveLength(3);
    expect(scripts.find((script) => script.id === 'obs-scene-change')).toMatchObject({
      id: 'obs-scene-change',
      status: 'not-installed',
    });
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
    expect(result.installedFiles).toHaveLength(5);
    expect(result.strategy).toBe('link');

    const installedIndexPath = path.join(result.targetDir, 'index.ts');
    const installedReadmePath = path.join(result.targetDir, 'README.md');
    const installedIndex = await fs.readFile(installedIndexPath, 'utf8');
    const installedReadme = await fs.readFile(installedReadmePath, 'utf8');
    const installedConfig = await fs.readFile(path.join(result.targetDir, 'config.jsonc'), 'utf8');
    const installedHelper = await fs.readFile(path.join(result.targetDir, 'config.ts'), 'utf8');
    const installedTypes = await fs.readFile(path.join(result.targetDir, 'types.d.ts'), 'utf8');

    expect(installedIndex).toContain('export default function setup(api: ScriptApi)');
    expect(installedReadme).toContain('# obs-startup');
    expect(installedConfig).toContain('"prepareScene"');
    expect(installedHelper).toContain('OBS_STARTUP_SCRIPT_ID');
    expect(installedTypes).toContain('export type { ScriptApi, UserScriptAction }');
    expect((await fs.lstat(installedIndexPath)).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(installedReadmePath)).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(result.targetDir, 'config.jsonc'))).isSymbolicLink()).toBe(
      false,
    );
  });

  test('install can force copy mode for local development installs', async () => {
    tempDir = await makeRepoTempDir('yash-scripts-install-copy');

    const result = installBundledExampleScript(tempDir, 'obs-startup', { strategy: 'copy' });
    expect(result.strategy).toBe('copy');
    expect((await fs.lstat(path.join(result.targetDir, 'index.ts'))).isSymbolicLink()).toBe(false);
    expect((await fs.lstat(path.join(result.targetDir, 'README.md'))).isSymbolicLink()).toBe(false);
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
    expect(await pathExists(path.join(targetDir, 'config.ts'))).toBe(false);
    expect(await pathExists(path.join(targetDir, 'types.d.ts'))).toBe(false);
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
      '[scripts]   obs-scene-change  — Minimal voice-friendly OBS scene switcher with configurable default scene. [not installed]',
    );
    expect(lines).toContain(
      '[scripts]   obs-startup  — Five-phase OBS startup sequence with countdown and go-live actions. [not installed]',
    );
    expect(lines).toContain(
      '[scripts]   obs-source-recaller  — Per-scene OBS source snapshot saver with automatic scene-change restores. [not installed]',
    );
    expect(lines).toContain(
      '[scripts] Usage: /scripts | /scripts list | /scripts install <example-id> [repair|force] [copy|link]',
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
      `[scripts] installed obs-startup into ${path.join(tempDir, 'scripts', 'obs-startup')} (link)`,
    );
    expect(
      lines.some(
        (line) => line.includes('linked') && line.endsWith('/scripts/obs-startup/index.ts'),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (line) => line.includes('copied') && line.endsWith('/scripts/obs-startup/config.jsonc'),
      ),
    ).toBe(true);
    expect(lines).toContain('[scripts] Restart yash to load the new script.');
  });

  test('install command accepts explicit copy mode', async () => {
    tempDir = await makeRepoTempDir('yash-scripts-command-copy');

    const lines: string[] = [];
    await handleScriptsCommand(
      ['/scripts', 'install', 'obs-startup', 'copy'],
      (line) => lines.push(line),
      tempDir,
    );

    expect(lines[0]).toBe(
      `[scripts] installed obs-startup into ${path.join(tempDir, 'scripts', 'obs-startup')} (copy)`,
    );
    expect(
      lines.some(
        (line) => line.includes('copied') && line.endsWith('/scripts/obs-startup/index.ts'),
      ),
    ).toBe(true);
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
    expect(lines[2]).toBe(
      '[scripts] Re-run with /scripts install <example-id> repair [copy|link] to refresh files and merge config.',
    );
    expect(await fs.readFile(path.join(targetDir, 'index.ts'), 'utf8')).toBe('// existing');
  });

  test('repair command refreshes files and merges config without erasing unknown values', async () => {
    tempDir = await makeRepoTempDir('yash-scripts-command-repair');
    const targetDir = path.join(tempDir, 'scripts', 'obs-startup');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'index.ts'), '// existing', 'utf8');
    await fs.writeFile(
      path.join(targetDir, 'config.jsonc'),
      `{
  "prepareScene": "Custom Prepare",
  "chatInterval": 5,
  "unknownSetting": "keep-me"
}
`,
      'utf8',
    );

    const lines: string[] = [];
    await handleScriptsCommand(
      ['/scripts', 'install', 'obs-startup', 'repair'],
      (line) => lines.push(line),
      tempDir,
    );

    expect(lines[0]).toBe(
      `[scripts] repaired obs-startup into ${path.join(tempDir, 'scripts', 'obs-startup')} (link)`,
    );
    expect(
      lines.some((line) => line.includes('merged config.jsonc with current values preserved')),
    ).toBe(true);
    const mergedConfig = JSON.parse(
      await fs.readFile(path.join(targetDir, 'config.jsonc'), 'utf8'),
    );
    expect(mergedConfig.prepareScene).toBe('Custom Prepare');
    expect(mergedConfig.chatInterval).toBe(5);
    expect(mergedConfig.unknownSetting).toBe('keep-me');
    expect(mergedConfig.liveScene).toBeDefined();
    expect(await pathExists(path.join(targetDir, 'config.jsonc.bak'))).toBe(true);
    expect(await pathExists(path.join(targetDir, 'config.jsonc.new'))).toBe(true);
  });
});
