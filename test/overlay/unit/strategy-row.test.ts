import { describe, it, expect } from 'vitest';
import { createUI, type ViewModel, type UIHandlers } from '../../../src/overlay/ui.js';

const noop = () => {};
const handlers: UIHandlers = {
  onToggleSelect: noop, onClose: noop, onNoteInput: noop, onRemoveElement: noop, onRemoveRegion: noop,
  onSend: noop, onSettings: noop, onToggleGroup: noop, onTab: noop, onToggleDone: noop, onGoPage: noop,
};

const baseVm: ViewModel = {
  selecting: false, connected: true, agent: { status: 'idle', text: '' }, strategy: 'reload',
  drafts: [], current: null, queue: [], batches: [], busy: false, locked: false, followPaused: false,
  pendingElsewhere: null, prefs: { theme: 'auto', themeLocked: false }, expanded: null, href: 'http://x/', tab: 'here', doneOpen: false, panelOpen: false,
};

describe('settings popover strategy row', () => {
  it('hides when vm.strategy is null (M1, Task 70 교정 라운드 1)', () => {
    const ui = createUI(handlers);
    ui.render(baseVm);
    const stratRow = ui.root.querySelector('.pop-row.strategy') as HTMLElement;
    expect(stratRow.hidden).toBe(false);
    ui.render({ ...baseVm, strategy: null });
    expect(stratRow.hidden).toBe(true);
  });
});
