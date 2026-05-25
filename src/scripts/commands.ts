import { listBundledExampleScripts } from './examples';
import { BundledExampleScriptInstallError, installBundledExampleScript } from './install';

function formatStatus(status: 'not-installed' | 'partial' | 'installed'): string {
  if (status === 'installed') return 'installed';
  if (status === 'partial') return 'partial install';
  return 'not installed';
}

export function renderScriptsHelpLines(dataDir: string): string[] {
  const scripts = listBundledExampleScripts(dataDir);
  const lines = ['[scripts] Bundled example scripts:'];

  for (const script of scripts) {
    lines.push(
      `[scripts]   ${script.id}  — ${script.description} [${formatStatus(script.status)}]`,
    );
  }

  lines.push('[scripts] Usage: /scripts | /scripts list | /scripts install <example-id>');
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
    emit('[scripts] Usage: /scripts | /scripts list | /scripts install <example-id>');
    return;
  }

  const scriptId = (parts[2] ?? '').toLowerCase();
  if (!scriptId) {
    emit('[scripts] Usage: /scripts install <example-id>');
    return;
  }

  try {
    const result = installBundledExampleScript(dataDir, scriptId);
    emit(`[scripts] installed ${result.scriptId} into ${result.targetDir}`);
    for (const filePath of result.installedFiles) {
      emit(`[scripts]   copied ${filePath}`);
    }
    emit('[scripts] Restart yash to load the new script.');
  } catch (error) {
    if (error instanceof BundledExampleScriptInstallError) {
      emit(`[scripts] ${error.message}`);
      for (const detail of error.details) emit(`[scripts]   ${detail}`);
      return;
    }
    emit(`[scripts] Failed to install example script: ${String(error)}`);
  }
}
