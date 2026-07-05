import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { IpcActionError } from '../actions/registry';
import type { ScriptActionsModalSpec } from '../actions/types';

export type ScriptActionsModalState = {
  box: BoxRenderable;
  focusIndex: number;
};

export type ScriptActionListItem = {
  id: string;
  title: string;
  description: string;
  args: Record<string, unknown>;
  visibility: string;
  safety: string;
  scriptId?: string;
};

export type ScriptActionsModalContext = {
  renderer: CliRenderer;
  hasBlockingModal: () => boolean;
  getActiveModal: () => ScriptActionsModalState | null;
  setActiveModal: (modal: ScriptActionsModalState | null) => void;
  listActions: () => ScriptActionListItem[];
  invokeActionFromTui: (
    id: string,
    args: Record<string, unknown>,
    emit: (line: string) => void,
  ) => Promise<void>;
  prefillMainInput: (value: string) => void;
  appendMessage: (message: string) => void;
  update: () => void;
  focusMainInput: () => void;
};

export function getVisibleScriptActions(
  actions: ScriptActionListItem[],
  spec: ScriptActionsModalSpec,
): ScriptActionListItem[] {
  return actions
    .filter(
      (action) =>
        action.scriptId === spec.scriptId &&
        action.visibility === 'public' &&
        action.safety !== 'blocked' &&
        action.id !== `${spec.actionPrefix}.actions`,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getLocalScriptActionId(actionId: string, actionPrefix: string): string {
  return actionId.startsWith(`${actionPrefix}.`)
    ? actionId.slice(actionPrefix.length + 1)
    : actionId;
}

export function formatScriptActionRow(
  action: ScriptActionListItem,
  actionPrefix: string,
  selected: boolean,
): string {
  const hasArgs = Object.keys(action.args ?? {}).length > 0;
  const localId = getLocalScriptActionId(action.id, actionPrefix);
  return `${selected ? '>' : ' '} ${localId}${hasArgs ? '  [args]' : ''}`;
}

export function openScriptActionsModal(
  ctx: ScriptActionsModalContext,
  spec: ScriptActionsModalSpec,
): void {
  if (ctx.hasBlockingModal()) return;

  const actions = getVisibleScriptActions(ctx.listActions(), spec);

  if (actions.length === 0) {
    ctx.appendMessage(`[${spec.actionPrefix}] no actions available for ${spec.scriptId}`);
    return;
  }

  const { renderer } = ctx;
  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '10%',
    left: '10%',
    width: '80%',
    height: '78%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ` ${spec.title} `,
  });

  const intro = new TextRenderable(renderer, {
    content:
      spec.intro ??
      ' Tab/Shift+Tab choose an action. Enter invokes no-arg actions or prefills `/action <id> ` in the main input when args are available. Esc cancels.',
    fg: 'gray',
  });
  const detail = new TextRenderable(renderer, {
    content: '',
    fg: 'gray',
    wrap: 'word',
  } as any);
  const keyCapture = new InputRenderable(renderer, {
    width: '100%',
    placeholder: ' Enter runs the selected action. Esc closes.',
  });
  const scroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: false,
    stickyStart: 'top',
    scrollX: false,
    scrollY: true,
  });
  const content = new BoxRenderable(renderer, {
    flexDirection: 'column',
    gap: 0,
    width: '100%',
  });
  scroll.add(content);
  box.add(intro);
  box.add(scroll);
  box.add(detail);
  box.add(keyCapture);
  renderer.root.add(box);

  let selectedIndex = 0;
  const clearBox = (target: BoxRenderable): void => {
    for (const child of target.getChildren()) target.remove(child.id);
  };
  const renderRows = (): void => {
    clearBox(content);
    for (const [index, action] of actions.entries()) {
      const row = new TextRenderable(renderer, {
        content: formatScriptActionRow(action, spec.actionPrefix, index === selectedIndex),
        fg: index === selectedIndex ? 'cyan' : 'white',
        backgroundColor: index === selectedIndex ? '#1f2937' : undefined,
      } as any);
      content.add(row);
    }
    const selected = actions[selectedIndex];
    if (selected) {
      const argNames = Object.keys(selected.args ?? {});
      detail.content =
        `${selected.title}\n${selected.description}` +
        (argNames.length > 0 ? `\nArgs: ${argNames.join(', ')}` : '\nArgs: none');
    }
  };
  const closeModal = (): void => {
    if (!ctx.getActiveModal()) return;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();
  };
  const moveSelection = (delta: number): void => {
    const activeModal = ctx.getActiveModal();
    if (!activeModal) return;
    selectedIndex = (selectedIndex + delta + actions.length) % actions.length;
    activeModal.focusIndex = selectedIndex;
    renderRows();
  };
  const submitSelection = (): void => {
    void (async () => {
      const selected = actions[selectedIndex];
      if (!selected) return;
      closeModal();
      if (Object.keys(selected.args ?? {}).length > 0) {
        ctx.prefillMainInput(`/action ${selected.id} `);
        return;
      }
      try {
        await ctx.invokeActionFromTui(selected.id, {}, ctx.appendMessage);
      } catch (err) {
        const msg = err instanceof IpcActionError ? err.message : String(err);
        ctx.appendMessage(`[action] ${msg}`);
      }
      ctx.update();
    })();
  };
  ctx.setActiveModal({ box, focusIndex: 0 });

  renderRows();
  keyCapture.on(InputRenderableEvents.INPUT, () => {
    keyCapture.value = '';
  });
  keyCapture.on(InputRenderableEvents.ENTER, submitSelection);
  keyCapture.onKeyDown = ((key: { name: string }) => {
    if (key.name === 'escape') closeModal();
  }) as any;
  setTimeout(() => {
    if (ctx.getActiveModal()?.box.id === box.id) keyCapture.focus();
  }, 0);

  const modalKeyHandler = (sequence: string): boolean => {
    if (!ctx.getActiveModal()) return false;
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      closeModal();
      return true;
    }
    if (sequence === '\t') {
      moveSelection(1);
      return true;
    }
    if (sequence === '\x1b[Z') {
      moveSelection(-1);
      return true;
    }
    if (sequence === '\r' || sequence === '\n') {
      submitSelection();
      return true;
    }
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);
}
