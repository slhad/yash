import { BoxRenderable, type CliRenderer, InputRenderable, TextRenderable } from '@opentui/core';
import type { StreamMarker } from '../platforms/base';

export type MarkerEditModalState = {
  box: BoxRenderable;
  focusIndex: number;
};

export type MarkerEditResult = {
  output?: string[];
  warnings?: string[];
};

export type MarkerEditModalContext = {
  renderer: CliRenderer;
  hasBlockingModal: () => boolean;
  getActiveModal: () => MarkerEditModalState | null;
  setActiveModal: (modal: MarkerEditModalState | null) => void;
  focusMainInput: () => void;
  appendAndRender: (message: string) => void;
  createIndentedInputRow: (
    renderer: CliRenderer,
    input: InputRenderable,
    indent?: string,
  ) => BoxRenderable;
  getMarker: (selectionId: number) => StreamMarker | null | undefined;
  editMarker: (selectionId: number, text: string, timestamp: number) => Promise<MarkerEditResult>;
  formatEditError: (error: unknown) => string;
};

export function parseMarkerTimestampInput(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function openMarkerEditModal(ctx: MarkerEditModalContext, selectionId: number): void {
  if (ctx.hasBlockingModal()) return;

  const marker = ctx.getMarker(selectionId);
  if (!marker) {
    ctx.appendAndRender(`[markers] Unknown persisted marker #${selectionId}`);
    return;
  }

  const { renderer } = ctx;
  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '18%',
    left: '12%',
    width: '76%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ` Edit Marker #${selectionId} `,
  });

  const instructions = new TextRenderable(renderer, {
    content:
      ' Update the label and/or timestamp for this persisted YouTube marker. Enter saves, Esc cancels.',
    fg: 'gray',
  });
  const currentText = new TextRenderable(renderer, {
    content: ` Current: ${marker.description || '(untitled)'} @ ${marker.positionInSeconds}s`,
    fg: 'yellow',
  });
  const descriptionLabel = new TextRenderable(renderer, {
    content: ' Description:',
    fg: 'cyan',
  });
  const descriptionInput = new InputRenderable(renderer, {
    placeholder: 'marker label',
    width: '100%',
  });
  descriptionInput.value = marker.description;
  const descriptionRow = ctx.createIndentedInputRow(renderer, descriptionInput, '    ');

  const timestampLabel = new TextRenderable(renderer, {
    content: ' Timestamp (s):',
    fg: 'cyan',
  });
  const timestampInput = new InputRenderable(renderer, {
    placeholder: 'seconds from stream start',
    width: '100%',
  });
  timestampInput.value = String(marker.positionInSeconds);
  const timestampRow = ctx.createIndentedInputRow(renderer, timestampInput, '    ');

  const hint = new TextRenderable(renderer, {
    content: '  [Tab] navigate  [Enter] save  [Esc] cancel',
    fg: 'gray',
  });

  box.add(instructions);
  box.add(currentText);
  box.add(descriptionLabel);
  box.add(descriptionRow);
  box.add(timestampLabel);
  box.add(timestampRow);
  box.add(hint);
  renderer.root.add(box);

  const inputs = [descriptionInput, timestampInput];
  let focusIndex = 0;
  ctx.setActiveModal({ box, focusIndex });
  descriptionInput.focus();

  async function closeModal(save: boolean): Promise<void> {
    if (!ctx.getActiveModal()) return;
    let parsedTimestamp: number | null = null;
    if (save) {
      parsedTimestamp = parseMarkerTimestampInput(timestampInput.value);
      if (parsedTimestamp === null) {
        ctx.appendAndRender('[markers] Timestamp must be a non-negative integer.');
        return;
      }
    }

    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();

    if (!save) {
      ctx.appendAndRender(`[markers] edit cancelled for #${selectionId}`);
      return;
    }

    try {
      const result = await ctx.editMarker(selectionId, descriptionInput.value, parsedTimestamp!);
      for (const line of result.output ?? []) ctx.appendAndRender(line);
      for (const warn of result.warnings ?? []) ctx.appendAndRender(`[system] ${warn}`);
    } catch (err) {
      ctx.appendAndRender(ctx.formatEditError(err));
    }
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!ctx.getActiveModal()) return false;
    if (sequence === '\t') {
      inputs[focusIndex]?.blur();
      focusIndex = (focusIndex + 1) % inputs.length;
      const modal = ctx.getActiveModal();
      if (modal) modal.focusIndex = focusIndex;
      inputs[focusIndex]?.focus();
      return true;
    }
    if (sequence === '\x1b[Z') {
      inputs[focusIndex]?.blur();
      focusIndex = (focusIndex - 1 + inputs.length) % inputs.length;
      const modal = ctx.getActiveModal();
      if (modal) modal.focusIndex = focusIndex;
      inputs[focusIndex]?.focus();
      return true;
    }
    if (sequence === '\r' || sequence === '\n') {
      void closeModal(true);
      return true;
    }
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      void closeModal(false);
      return true;
    }
    if (sequence === '\x1b[A' || sequence === '\x1b[B') return true;
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && ctx.getActiveModal()) void closeModal(false);
  };
  for (const input of inputs) {
    input.onKeyDown = escapeViaKeyDown;
  }
}
