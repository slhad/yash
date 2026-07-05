import { BoxRenderable, type CliRenderer, InputRenderable, TextRenderable } from '@opentui/core';
import type {
  ObsShutdownConfigDraft,
  validateObsShutdownConfigDraft,
} from '../utils/obsShutdownConfig';

export type ObsShutdownConfigModalState = {
  box: BoxRenderable;
  focusIndex: number;
};

type ObsShutdownValidationResult = ReturnType<typeof validateObsShutdownConfigDraft>;

type ObsShutdownApplyResult = {
  changedKeys: string[];
  errors: string[];
};

export type ObsShutdownConfigModalContext = {
  renderer: CliRenderer;
  hasBlockingModal: () => boolean;
  getActiveModal: () => ObsShutdownConfigModalState | null;
  setActiveModal: (modal: ObsShutdownConfigModalState | null) => void;
  loadDraft: () => ObsShutdownConfigDraft;
  validateDraft: (draft: ObsShutdownConfigDraft) => ObsShutdownValidationResult;
  applyConfigPatch: (
    draft: NonNullable<ObsShutdownValidationResult['values']>,
  ) => ObsShutdownApplyResult;
  persistSettingEntries: (entries: Array<{ key: string; value: unknown }>) => Promise<string[]>;
  createIndentedInputRow: (
    renderer: CliRenderer,
    input: InputRenderable,
    indent?: string,
  ) => BoxRenderable;
  appendMessage: (message: string) => void;
  update: () => void;
  focusMainInput: () => void;
};

type ObsShutdownInputValues = Omit<ObsShutdownConfigDraft, 'stopStream'>;

export function buildObsShutdownDraftFromInputValues(
  values: ObsShutdownInputValues,
  stopStream: boolean,
): ObsShutdownConfigDraft {
  return {
    delay: values.delay,
    scene: values.scene,
    message: values.message,
    chatInterval: values.chatInterval,
    stopStream,
    source: values.source,
    sourceText: values.sourceText,
    hideSources: values.hideSources,
    muteSources: values.muteSources,
    finalCountdownAt: values.finalCountdownAt,
  };
}

export function makeObsShutdownToggleRow(label: string, value: boolean, focused: boolean): string {
  return `${focused ? '▶' : ' '} ${label}: ${value ? 'ON' : 'OFF'}`;
}

export function openObsShutdownConfigModal(ctx: ObsShutdownConfigModalContext): void {
  if (ctx.hasBlockingModal()) return;

  const { renderer } = ctx;
  const draft = ctx.loadDraft();

  function makeLabel(text: string): TextRenderable {
    return new TextRenderable(renderer, { content: text, fg: 'gray' });
  }

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
    title: ' OBS Shutdown Config ',
  });

  const intro = new TextRenderable(renderer, {
    content:
      ' Tab/Shift+Tab move focus. Space or ◄/► toggles stopStream. Enter saves all changes. Esc cancels.',
    fg: 'gray',
  });

  const sceneLabel = makeLabel('  scene: OBS scene to switch to before the countdown starts');
  const sceneInput = new InputRenderable(renderer, { placeholder: '[PS] End', width: '100%' });
  sceneInput.value = draft.scene;
  const delayLabel = makeLabel('  delay: countdown duration in seconds (10-3600)');
  const delayInput = new InputRenderable(renderer, { placeholder: '30', width: '100%' });
  delayInput.value = draft.delay;
  const messageLabel = makeLabel(
    '  message: chat template, use {remaining} for the countdown value',
  );
  const messageInput = new InputRenderable(renderer, {
    placeholder: 'Stream ending in {remaining}s!',
    width: '100%',
  });
  messageInput.value = draft.message;
  const chatIntervalLabel = makeLabel('  chatInterval: seconds between chat countdown updates');
  const chatIntervalInput = new InputRenderable(renderer, { placeholder: '10', width: '100%' });
  chatIntervalInput.value = draft.chatInterval;
  const stopStreamRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const sourceLabel = makeLabel(
    '  source: optional OBS text source to update during the countdown',
  );
  const sourceInput = new InputRenderable(renderer, {
    placeholder: '[TXT] Countdown',
    width: '100%',
  });
  sourceInput.value = draft.source;
  const sourceTextLabel = makeLabel(
    '  sourceText: source template, use {remaining} for the countdown value',
  );
  const sourceTextInput = new InputRenderable(renderer, {
    placeholder: '{remaining}',
    width: '100%',
  });
  sourceTextInput.value = draft.sourceText;
  const hideSourcesLabel = makeLabel(
    '  hideSources: comma-separated OBS sources to hide during shutdown',
  );
  const hideSourcesInput = new InputRenderable(renderer, {
    placeholder: 'Camera A, Camera B',
    width: '100%',
  });
  hideSourcesInput.value = draft.hideSources;
  const muteSourcesLabel = makeLabel(
    '  muteSources: comma-separated OBS inputs to mute during shutdown',
  );
  const muteSourcesInput = new InputRenderable(renderer, { placeholder: 'Mic/Aux', width: '100%' });
  muteSourcesInput.value = draft.muteSources;
  const finalCountdownLabel = makeLabel(
    '  finalCountdownAt: switch chat updates to every second from this value',
  );
  const finalCountdownInput = new InputRenderable(renderer, { placeholder: '0', width: '100%' });
  finalCountdownInput.value = draft.finalCountdownAt;

  const sceneRow = ctx.createIndentedInputRow(renderer, sceneInput, '    ');
  const delayRow = ctx.createIndentedInputRow(renderer, delayInput, '    ');
  const messageRow = ctx.createIndentedInputRow(renderer, messageInput, '    ');
  const chatIntervalRow = ctx.createIndentedInputRow(renderer, chatIntervalInput, '    ');
  const sourceRow = ctx.createIndentedInputRow(renderer, sourceInput, '    ');
  const sourceTextRow = ctx.createIndentedInputRow(renderer, sourceTextInput, '    ');
  const hideSourcesRow = ctx.createIndentedInputRow(renderer, hideSourcesInput, '    ');
  const muteSourcesRow = ctx.createIndentedInputRow(renderer, muteSourcesInput, '    ');
  const finalCountdownRow = ctx.createIndentedInputRow(renderer, finalCountdownInput, '    ');

  box.add(intro);
  box.add(sceneLabel);
  box.add(sceneRow);
  box.add(delayLabel);
  box.add(delayRow);
  box.add(messageLabel);
  box.add(messageRow);
  box.add(chatIntervalLabel);
  box.add(chatIntervalRow);
  box.add(stopStreamRow);
  box.add(sourceLabel);
  box.add(sourceRow);
  box.add(sourceTextLabel);
  box.add(sourceTextRow);
  box.add(hideSourcesLabel);
  box.add(hideSourcesRow);
  box.add(muteSourcesLabel);
  box.add(muteSourcesRow);
  box.add(finalCountdownLabel);
  box.add(finalCountdownRow);
  renderer.root.add(box);

  type ObsShutdownFocusItem =
    | { kind: 'input'; node: InputRenderable }
    | {
        kind: 'toggle';
        node: TextRenderable;
        render: (focused: boolean) => void;
        toggle: () => void;
      };

  const items: ObsShutdownFocusItem[] = [
    { kind: 'input', node: sceneInput },
    { kind: 'input', node: delayInput },
    { kind: 'input', node: messageInput },
    { kind: 'input', node: chatIntervalInput },
    {
      kind: 'toggle',
      node: stopStreamRow,
      render: (focused) => {
        stopStreamRow.content = makeObsShutdownToggleRow(
          'stopStream',
          draft.stopStream,
          focused,
        ).concat('  - stop the OBS stream when the countdown reaches zero');
        stopStreamRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.stopStream = !draft.stopStream;
      },
    },
    { kind: 'input', node: sourceInput },
    { kind: 'input', node: sourceTextInput },
    { kind: 'input', node: hideSourcesInput },
    { kind: 'input', node: muteSourcesInput },
    { kind: 'input', node: finalCountdownInput },
  ];

  let focusIdx = 0;
  ctx.setActiveModal({ box, focusIndex: 0 });

  function blurCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') current.node.blur();
    else current.render(false);
  }

  function focusCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') current.node.focus();
    else current.render(true);
  }

  function renderRows(): void {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind === 'input') continue;
      item.render(i === focusIdx);
    }
  }

  renderRows();
  focusCurrent();

  async function saveAndClose(): Promise<void> {
    const validation = ctx.validateDraft(
      buildObsShutdownDraftFromInputValues(
        {
          delay: delayInput.value,
          scene: sceneInput.value,
          message: messageInput.value,
          chatInterval: chatIntervalInput.value,
          source: sourceInput.value,
          sourceText: sourceTextInput.value,
          hideSources: hideSourcesInput.value,
          muteSources: muteSourcesInput.value,
          finalCountdownAt: finalCountdownInput.value,
        },
        draft.stopStream,
      ),
    );

    if (!validation.values) {
      for (const error of validation.errors) {
        ctx.appendMessage(`[obs-shutdown] ${error}`);
      }
      ctx.update();
      return;
    }

    const result = ctx.applyConfigPatch(validation.values);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        ctx.appendMessage(`[obs-shutdown] ${error}`);
      }
      ctx.update();
      return;
    }

    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();

    if (result.changedKeys.length === 0) {
      ctx.appendMessage('[obs-shutdown] No changes.');
    } else {
      ctx.appendMessage(`[obs-shutdown] Updated: ${result.changedKeys.join(', ')}`);
    }
    ctx.update();
  }

  function cancelAndClose(): void {
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!ctx.getActiveModal()) return false;
    const current = items[focusIdx];
    if (!current) return false;

    if (sequence === '\t' || sequence === '\x1b[Z') {
      blurCurrent();
      focusIdx = (focusIdx + (sequence === '\t' ? 1 : -1) + items.length) % items.length;
      const activeModal = ctx.getActiveModal();
      if (activeModal) activeModal.focusIndex = focusIdx;
      focusCurrent();
      return true;
    }

    if (
      current.kind === 'toggle' &&
      (sequence === ' ' || sequence === '\x1b[C' || sequence === '\x1b[D')
    ) {
      current.toggle();
      current.render(true);
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
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && ctx.getActiveModal()) cancelAndClose();
  };
  for (const input of [
    sceneInput,
    delayInput,
    messageInput,
    chatIntervalInput,
    sourceInput,
    sourceTextInput,
    hideSourcesInput,
    muteSourcesInput,
    finalCountdownInput,
  ]) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}
