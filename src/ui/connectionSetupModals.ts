import { BoxRenderable, type CliRenderer, InputRenderable, TextRenderable } from '@opentui/core';

export type ConnectionSetupModalState = {
  box: BoxRenderable;
  focusIndex: number;
};

type SaveConfig = (patch: Record<string, unknown>) => Promise<void>;

type ModalContext = {
  renderer: CliRenderer;
  getActiveModal: () => ConnectionSetupModalState | null;
  setActiveModal: (modal: ConnectionSetupModalState | null) => void;
  focusMainInput: () => void;
  appendMessage: (message: string) => void;
  saveConfig: SaveConfig;
};

type ProviderCredentialSpec = {
  platform: 'twitch' | 'kick' | 'youtube';
  title: string;
  borderColor: string;
  labelColor: string;
  instructions: string;
  clientIdPlaceholder: string;
  clientSecretPlaceholder: string;
  savedMessage: string;
  cancelledMessage: string;
};

type ObsServiceLike = {
  getConnectionInfo(): { host: string; port: number; password?: string | null };
  isConnected(): boolean;
  reconfigure(host: string, port: number, password: string | null): void;
  disconnect(): Promise<void>;
  connect(): Promise<void>;
};

export function buildProviderCredentialConfig(
  platform: ProviderCredentialSpec['platform'],
  clientIdValue: string,
  clientSecretValue: string,
): Record<string, unknown> {
  const clientId = clientIdValue.trim();
  const clientSecret = clientSecretValue.trim();
  return {
    platforms: {
      [platform]: {
        ...(clientId ? { clientId } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      },
    },
  };
}

export function normalizeObsConnectionInput(
  hostValue: string,
  portValue: string,
  passwordValue: string,
): { host: string; port: number; password: string | null } {
  return {
    host: hostValue.trim() || 'localhost',
    port: Number.parseInt(portValue.trim(), 10) || 4455,
    password: passwordValue.trim() || null,
  };
}

function addEscapeKeyHandlers(
  inputs: InputRenderable[],
  getActiveModal: () => ConnectionSetupModalState | null,
  closeModal: (save: boolean) => void,
): void {
  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && getActiveModal()) closeModal(false);
  };
  for (const input of inputs) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}

function installModalKeyHandler(
  ctx: ModalContext,
  inputs: InputRenderable[],
  closeModal: (save: boolean) => void,
): (sequence: string) => boolean {
  const modalKeyHandler = (sequence: string): boolean => {
    const activeModal = ctx.getActiveModal();
    if (!activeModal) return false;
    if (sequence === '\t') {
      inputs[activeModal.focusIndex]?.blur();
      activeModal.focusIndex = (activeModal.focusIndex + 1) % inputs.length;
      inputs[activeModal.focusIndex]?.focus();
      return true;
    }
    if (sequence === '\r' || sequence === '\n') {
      closeModal(true);
      return true;
    }
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      closeModal(false);
      return true;
    }
    if (sequence === '\x1b[A' || sequence === '\x1b[B') return true;
    return false;
  };

  ctx.renderer.prependInputHandler(modalKeyHandler);
  return modalKeyHandler;
}

function openProviderCredentialModal(ctx: ModalContext, spec: ProviderCredentialSpec): void {
  const { renderer } = ctx;

  const instructions = new TextRenderable(renderer, {
    content: spec.instructions,
    fg: 'white',
  });

  const clientIdLabel = new TextRenderable(renderer, {
    content: ' Client ID:',
    fg: spec.labelColor,
  });
  const clientIdInput = new InputRenderable(renderer, {
    placeholder: spec.clientIdPlaceholder,
    width: '100%',
  });

  const clientSecretLabel = new TextRenderable(renderer, {
    content: ' Client Secret:',
    fg: spec.labelColor,
  });
  const clientSecretInput = new InputRenderable(renderer, {
    placeholder: spec.clientSecretPlaceholder,
    width: '100%',
  });

  const hint = new TextRenderable(renderer, {
    content: ' [Tab] switch field   [Enter] save   [Esc] cancel',
    fg: 'gray',
  });

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '10%',
    left: '10%',
    width: '80%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: spec.borderColor,
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: spec.title,
  });

  box.add(instructions);
  box.add(clientIdLabel);
  box.add(clientIdInput);
  box.add(clientSecretLabel);
  box.add(clientSecretInput);
  box.add(hint);

  renderer.root.add(box);
  ctx.setActiveModal({ box, focusIndex: 0 });

  const inputs = [clientIdInput, clientSecretInput];
  inputs[0]?.focus();

  let modalKeyHandler: ((sequence: string) => boolean) | null = null;
  function closeModal(save: boolean): void {
    if (!ctx.getActiveModal()) return;
    if (save) {
      ctx
        .saveConfig(
          buildProviderCredentialConfig(
            spec.platform,
            clientIdInput.value,
            clientSecretInput.value,
          ),
        )
        .then(() => {
          ctx.appendMessage(spec.savedMessage);
        });
    } else {
      ctx.appendMessage(spec.cancelledMessage);
    }
    if (modalKeyHandler) renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();
  }

  modalKeyHandler = installModalKeyHandler(ctx, inputs, closeModal);
  addEscapeKeyHandlers(inputs, ctx.getActiveModal, closeModal);
}

export function openTwitchSetupModal(ctx: ModalContext): void {
  openProviderCredentialModal(ctx, {
    platform: 'twitch',
    title: ' Twitch Setup ',
    borderColor: 'cyan',
    labelColor: 'cyan',
    instructions:
      ' To connect Twitch, create an app at dev.twitch.tv/console,\n' +
      ' set redirect URL to http://localhost:3000/api/twitch/callback,\n' +
      ' then fill in the fields below. Press Tab to move between fields,\n' +
      ' Enter to save, Escape to cancel.\n',
    clientIdPlaceholder: 'paste your Twitch Client ID…',
    clientSecretPlaceholder: 'paste your Twitch Client Secret…',
    savedMessage: '[system] Twitch credentials saved. Run /connect twitch to authenticate.',
    cancelledMessage: '[system] Twitch setup cancelled.',
  });
}

export function openKickSetupModal(ctx: ModalContext): void {
  openProviderCredentialModal(ctx, {
    platform: 'kick',
    title: ' Kick Setup ',
    borderColor: 'green',
    labelColor: 'cyan',
    instructions:
      ' To connect Kick:\n' +
      '  1. Enable 2FA on your account (required by Kick)\n' +
      '  2. Go to kick.com/settings/developer and create an app\n' +
      '  3. Set redirect URL to http://localhost:3000/api/kick/callback\n' +
      '  4. Paste the generated Client ID and Client Secret below.\n',
    clientIdPlaceholder: 'paste your Kick Client ID…',
    clientSecretPlaceholder: 'paste your Kick Client Secret…',
    savedMessage: '[system] Kick credentials saved. Run /connect kick to authenticate.',
    cancelledMessage: '[system] Kick setup cancelled.',
  });
}

export function openYouTubeCredentialsModal(ctx: ModalContext): void {
  openProviderCredentialModal(ctx, {
    platform: 'youtube',
    title: ' YouTube Setup ',
    borderColor: 'red',
    labelColor: 'red',
    instructions:
      ' To connect YouTube:\n' +
      '  1. Go to console.cloud.google.com and create a project\n' +
      '  2. Enable the YouTube Data API v3\n' +
      '  3. Under Credentials, create an OAuth 2.0 Client ID (Web application)\n' +
      '  4. Add http://localhost:3000/api/youtube/callback as an authorized redirect URI\n' +
      '  5. Paste the generated Client ID and Client Secret below.\n',
    clientIdPlaceholder: 'paste your Google OAuth Client ID…',
    clientSecretPlaceholder: 'paste your Google OAuth Client Secret…',
    savedMessage: '[system] YouTube credentials saved. Run /connect youtube to authenticate.',
    cancelledMessage: '[system] YouTube setup cancelled.',
  });
}

export function openObsConnectModal(ctx: ModalContext, obsService: ObsServiceLike): void {
  const { renderer } = ctx;
  const info = obsService.getConnectionInfo();
  const statusLabel = obsService.isConnected() ? '● Connected' : '○ Disconnected';

  const instructions = new TextRenderable(renderer, {
    content:
      ` OBS status: ${statusLabel}\n\n` +
      ' To enable the OBS WebSocket server:\n' +
      '  OBS → Tools → WebSocket Server Settings → Enable WebSocket server\n' +
      '  Set the port and password below to match.\n',
    fg: 'white',
  });

  const hostLabel = new TextRenderable(renderer, { content: ' Host:', fg: 'yellow' });
  const hostInput = new InputRenderable(renderer, {
    placeholder: 'e.g. localhost',
    width: '100%',
    value: info.host,
  });

  const portLabel = new TextRenderable(renderer, { content: ' Port:', fg: 'yellow' });
  const portInput = new InputRenderable(renderer, {
    placeholder: 'e.g. 4455',
    width: '100%',
    value: String(info.port),
  });

  const passwordLabel = new TextRenderable(renderer, { content: ' Password:', fg: 'yellow' });
  const passwordInput = new InputRenderable(renderer, {
    placeholder: '(leave blank if no password)',
    width: '100%',
    value: info.password ?? '',
  });

  const hint = new TextRenderable(renderer, {
    content: ' [Tab] switch field   [Enter] connect   [Esc] cancel',
    fg: 'gray',
  });

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '10%',
    left: '10%',
    width: '80%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'yellow',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' OBS WebSocket ',
  });

  box.add(instructions);
  box.add(hostLabel);
  box.add(hostInput);
  box.add(portLabel);
  box.add(portInput);
  box.add(passwordLabel);
  box.add(passwordInput);
  box.add(hint);

  renderer.root.add(box);
  ctx.setActiveModal({ box, focusIndex: 0 });

  const inputs = [hostInput, portInput, passwordInput];
  inputs[0]?.focus();

  let modalKeyHandler: ((sequence: string) => boolean) | null = null;
  function closeModal(save: boolean): void {
    if (!ctx.getActiveModal()) return;
    if (modalKeyHandler) renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();

    if (!save) {
      return;
    }

    const { host, port, password } = normalizeObsConnectionInput(
      hostInput.value,
      portInput.value,
      passwordInput.value,
    );

    ctx
      .saveConfig({
        obs: { websocket: { server: host, port: String(port), password: password ?? '' } },
      })
      .then(async () => {
        obsService.reconfigure(host, port, password);
        ctx.appendMessage(`[obs] Saved — ws://${host}:${port}  password: ${password ?? '(none)'}`);
        if (obsService.isConnected()) {
          await obsService.disconnect();
        }
        ctx.appendMessage('[obs] Connecting...');
        try {
          await obsService.connect();
          ctx.appendMessage('[obs] Connected to OBS');
        } catch {
          ctx.appendMessage(
            '[obs] Connection failed — is OBS running with WebSocket server enabled?',
          );
        }
      });
  }

  modalKeyHandler = installModalKeyHandler(ctx, inputs, closeModal);
  addEscapeKeyHandlers(inputs, ctx.getActiveModal, closeModal);
}
