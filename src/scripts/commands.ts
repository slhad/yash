import { listBundledExampleScripts } from './examples';
import { BundledExampleScriptInstallError, installBundledExampleScript } from './install';

function formatStatus(status: 'not-installed' | 'partial' | 'installed'): string {
  if (status === 'installed') return 'installed';
  if (status === 'partial') return 'partial install';
  return 'not installed';
}

function isForceToken(token: string | undefined): boolean {
  const normalized = (token ?? '').toLowerCase();
  return normalized === 'force' || normalized === 'repair' || normalized === '--force';
}

function parseInstallStrategy(tokens: string[]): {
  strategy?: 'copy' | 'link';
  invalidTokens: string[];
} {
  let strategy: 'copy' | 'link' | undefined;
  const invalidTokens: string[] = [];

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === 'copy' || normalized === 'link') {
      strategy = normalized;
      continue;
    }
    if (isForceToken(normalized)) continue;
    invalidTokens.push(token);
  }

  return { strategy, invalidTokens };
}

export function renderScriptsHelpLines(dataDir: string): string[] {
  const scripts = listBundledExampleScripts(dataDir);
  const lines = ['[scripts] Bundled example scripts:'];

  for (const script of scripts) {
    lines.push(
      `[scripts]   ${script.id}  — ${script.description} [${formatStatus(script.status)}]`,
    );
  }

  lines.push(
    '[scripts] Usage: /scripts | /scripts list | /scripts install <example-id> [repair|force] [copy|link]',
  );
  lines.push(
    '[scripts] Local installs default to symlinking tracked script files and copying config.jsonc; AppImage installs default to copy mode.',
  );
  lines.push(
    '[scripts] Repair/force refreshes tracked files and merges config.jsonc with your current values preserved.',
  );
  lines.push('[scripts] Installed examples load after you restart yash.');
  return lines;
}

export async function handleScriptsCommand(
  parts: string[],
  emit: (line: string) => void,
  dataDir: string,
): Promise<void> {
  const subcommand = (parts[1] ?? '').toLowerCase();

  if (!subcommand || subcommand === 'list') {
    for (const line of renderScriptsHelpLines(dataDir)) emit(line);
    return;
  }

  if (subcommand !== 'install') {
    emit(
      '[scripts] Usage: /scripts | /scripts list | /scripts install <example-id> [repair|force] [copy|link]',
    );
    return;
  }

  const scriptId = (parts[2] ?? '').toLowerCase();
  if (!scriptId) {
    emit('[scripts] Usage: /scripts install <example-id> [repair|force] [copy|link]');
    return;
  }

  const optionTokens = parts.slice(3);
  const { strategy, invalidTokens } = parseInstallStrategy(optionTokens);
  if (invalidTokens.length > 0) {
    emit('[scripts] Usage: /scripts install <example-id> [repair|force] [copy|link]');
    for (const token of invalidTokens) {
      emit(`[scripts]   Unknown install option: ${token}`);
    }
    return;
  }

  try {
    const result = installBundledExampleScript(dataDir, scriptId, {
      force: optionTokens.some((token) => isForceToken(token)),
      strategy,
    });
    emit(
      `[scripts] ${result.mode === 'repair' ? 'repaired' : 'installed'} ${result.scriptId} into ${result.targetDir} (${result.strategy})`,
    );
    for (const fileResult of result.fileActions) {
      emit(`[scripts]   ${fileResult.action} ${fileResult.path}`);
    }
    for (const warning of result.warnings) emit(`[scripts]   ${warning}`);
    emit('[scripts] Restart yash to load the new script.');
  } catch (error) {
    if (error instanceof BundledExampleScriptInstallError) {
      emit(`[scripts] ${error.message}`);
      for (const detail of error.details) emit(`[scripts]   ${detail}`);
      if (error.code === 'TARGET_EXISTS') {
        emit(
          '[scripts] Re-run with /scripts install <example-id> repair [copy|link] to refresh files and merge config.',
        );
      }
      return;
    }
    emit(`[scripts] Failed to install example script: ${String(error)}`);
  }
}
