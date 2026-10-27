import { ArenaService } from './arena.service';

describe('Explicit arena tab targeting', () => {
  afterEach(() => { delete window.mrgoose; });
  it('keeps explicit caller targeting independent of the active tab', async () => {
    const fill = vi.fn(async () => ({ ok: true }));
    const list = vi.fn(async () => [{ id: 'other', active: true }]);
    window.mrgoose = { tabs: { list }, bridge: { fillField: fill } } as any;
    await new ArenaService().fill('#payload', 'exact', 'attempt-tab');
    expect(fill).toHaveBeenCalledExactlyOnceWith('attempt-tab', '#payload', 'exact');
    expect(list).not.toHaveBeenCalled();
  });
  it('captures the UI selection before invoking the explicit bridge', async () => {
    const read = vi.fn(async () => ({ ok: true, text: 'reply' }));
    window.mrgoose = { tabs: { list: async () => [{ id: 'ui-tab', active: true }] }, bridge: { readDom: read } } as any;
    await new ArenaService().read('#reply');
    expect(read).toHaveBeenCalledExactlyOnceWith('ui-tab', '#reply');
  });
  it('does not call the bridge when no tab exists', async () => {
    const fill = vi.fn();
    window.mrgoose = { tabs: { list: async () => [] }, bridge: { fillField: fill } } as any;
    expect((await new ArenaService().fill('#payload', 'x')).ok).toBe(false);
    expect(fill).not.toHaveBeenCalled();
  });
});
