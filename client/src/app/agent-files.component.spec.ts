import { TestBed } from '@angular/core/testing';
import { AgentFilesComponent } from './agent-files.component';
import { ApiService } from './api.service';
import { csvPreview } from './csv-preview';

const a = { id: 'file-a', name: 'report.csv', size: 40, createdAt: '2026-10-26T12:00:00Z' };
const b = { ...a, id: 'file-b', name: 'report.md' };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; };

describe('Session files panel', () => {
  let api: any;
  beforeEach(() => {
    api = { agentFiles: vi.fn(async () => [a, b]), agentFile: vi.fn(async () => ({ file: a, content: 'name,note\r\nAlice,"line 1\nline 2"\r\n' })) };
    TestBed.configureTestingModule({ imports: [AgentFilesComponent], providers: [{ provide: ApiService, useValue: api }] });
  });

  it('lists metadata, loads content only on selection, and renders CSV as a table', async () => {
    const fixture = TestBed.createComponent(AgentFilesComponent); fixture.componentRef.setInput('sessionId', 'session-a');
    await fixture.whenStable(); fixture.detectChanges();
    expect(api.agentFile).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.file-item')).toHaveLength(2);
    await fixture.componentInstance.select(a); fixture.detectChanges();
    expect(api.agentFile).toHaveBeenCalledWith('session-a', 'file-a');
    expect(fixture.nativeElement.querySelector('table').textContent).toContain('line 1\nline 2');
  });

  it('does not display an old session response after a session switch', async () => {
    const oldList = deferred<any[]>(); const oldRead = deferred<any>();
    api.agentFiles.mockImplementation((id: string) => id === 'session-a' ? oldList.promise : Promise.resolve([b]));
    api.agentFile.mockReturnValue(oldRead.promise);
    const fixture = TestBed.createComponent(AgentFilesComponent); const component = fixture.componentInstance;
    fixture.componentRef.setInput('sessionId', 'session-a'); fixture.detectChanges();
    const reading = component.select(a);
    fixture.componentRef.setInput('sessionId', 'session-b'); fixture.detectChanges(); await fixture.whenStable();
    oldList.resolve([a]); oldRead.resolve({ file: a, content: 'old secret' }); await reading; await Promise.resolve();
    expect(component.files()).toEqual([b]); expect(component.selected()).toBeNull(); expect(component.preview()).toBeNull();
  });

  it('escapes file content and preserves exact source text', async () => {
    const raw = '<script>not executable</script>\n<img src=x onerror=alert(1)> 🪿';
    api.agentFile.mockResolvedValue({ file: b, content: raw });
    const fixture = TestBed.createComponent(AgentFilesComponent); fixture.componentRef.setInput('sessionId', 'session-a'); await fixture.whenStable();
    await fixture.componentInstance.select(b); fixture.componentInstance.mode.set('text'); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.file-text')?.textContent).toBe(raw); expect(root.querySelector('script,img')).toBeNull();
  });

  it('defaults Markdown to formatted Preview and switches back to the exact Source', async () => {
    const markdown = '# Report\r\n\r\n**Important**\n\n| Name | State |\n| --- | --- |\n| Example | Untested |\n\n```txt\n  <system>literal payload</system>\n```\n';
    api.agentFile.mockResolvedValue({ file: b, content: markdown });
    const fixture = TestBed.createComponent(AgentFilesComponent); fixture.componentRef.setInput('sessionId', 'session-a'); await fixture.whenStable();
    await fixture.componentInstance.select(b); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.mg-file-markdown h1')?.textContent).toBe('Report');
    expect(root.querySelector('.mg-file-markdown strong')?.textContent).toBe('Important');
    expect(root.querySelectorAll('.mg-file-markdown tbody tr')).toHaveLength(1);
    expect(root.querySelector('.mg-file-markdown pre code')?.textContent).toBe('  <system>literal payload</system>\n');
    const source = [...root.querySelectorAll<HTMLButtonElement>('.preview-modes button')].find(b => b.textContent === 'Source')!;
    source.click(); fixture.detectChanges();
    expect(root.querySelector('.file-text')?.textContent).toBe(markdown);
    expect(fixture.componentInstance.preview()?.content).toBe(markdown);
  });

  it('does not execute HTML or load remote images from Markdown and only links HTTP(S)', async () => {
    const markdown = '<script>alert(1)</script>\n\n<img src="https://attacker.invalid/pixel" onerror="alert(1)">\n\n![pixel](https://attacker.invalid/track)\n\n[unsafe](javascript:alert%281%29) [safe](https://example.com/docs)';
    api.agentFile.mockResolvedValue({ file: b, content: markdown });
    const fixture = TestBed.createComponent(AgentFilesComponent); fixture.componentRef.setInput('sessionId', 'session-a'); await fixture.whenStable();
    await fixture.componentInstance.select(b); fixture.detectChanges();
    const preview = (fixture.nativeElement as HTMLElement).querySelector('.mg-file-markdown')!;
    expect(preview.querySelector('script,img,iframe,object')).toBeNull();
    expect(preview.textContent).toContain('<script>alert(1)</script>');
    const links = [...preview.querySelectorAll('a')]; expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com/docs');
    expect(links[0].getAttribute('rel')).toContain('noopener');
  });

  it('uploads multiple dropped files, rejects unsupported files, and emits attachment metadata', async () => {
    api.uploadAgentFile = vi.fn(async (_session: string, f: File) => ({ ...a, id: f.name, name: f.name, source: 'upload' }));
    const fixture = TestBed.createComponent(AgentFilesComponent); fixture.componentRef.setInput('sessionId', 'session-a'); await fixture.whenStable();
    const c = fixture.componentInstance; const uploaded = vi.fn(), busy = vi.fn(); c.fileUploaded.subscribe(uploaded); c.uploadingChange.subscribe(busy);
    await c.upload([new File(['hello'], 'one.txt'), new File(['a,b'], 'two.csv'), new File(['<script>'], 'no.html')]);
    expect(api.uploadAgentFile).toHaveBeenCalledTimes(2);
    expect(api.uploadAgentFile.mock.calls[0][0]).toBe('session-a');
    expect(uploaded).toHaveBeenCalledTimes(2); expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(c.uploadMessage()).toBe('Uploaded 2 files.'); expect(c.error()).toContain('no.html');
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { types: ['Files'], files: [new File(['x'], 'drop.txt')] } };
    c.dragEnter(event as any); expect(c.dragActive()).toBe(true);
    c.drop(event as any); expect(c.dragActive()).toBe(false);
    await fixture.whenStable(); expect(api.uploadAgentFile).toHaveBeenCalledTimes(3);
  });

  it('opens a requested attachment on the right without fetching unrelated file contents', async () => {
    const fixture = TestBed.createComponent(AgentFilesComponent);
    fixture.componentRef.setInput('sessionId', 'session-a'); fixture.componentRef.setInput('openFileId', 'file-a');
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.selected()?.id).toBe('file-a');
    expect(api.agentFile).toHaveBeenCalledExactlyOnceWith('session-a', 'file-a');
  });

  it('keeps selection after a refresh and shows recoverable backend errors', async () => {
    const fixture = TestBed.createComponent(AgentFilesComponent); fixture.componentRef.setInput('sessionId', 'session-a'); await fixture.whenStable();
    const c = fixture.componentInstance; await c.select(a); await c.load(); expect(c.selected()?.id).toBe(a.id);
    api.agentFiles.mockRejectedValue(new Error('offline')); await c.load(); expect(c.error()).toContain('Could not load');
    api.agentFiles.mockResolvedValue([]); await c.load(); expect(c.error()).toBe(''); expect(c.preview()).toBeNull(); expect(c.selected()).toBeNull();
  });
});

describe('CSV preview', () => {
  it('handles escaped quotes, commas, CRLF and embedded newlines', () => {
    expect(csvPreview('a,b\r\n"x,y","one\n""two"""\r\n').rows).toEqual([['a', 'b'], ['x,y', 'one\n"two"']]);
  });
  it('bounds display size and reports malformed quoted content', () => {
    expect(csvPreview('a,b\n1,2\n3,4', 2).truncated).toBe(true);
    expect(csvPreview('a,b,c\n1,2,3', 201, 2)).toEqual({ rows: [['a', 'b'], ['1', '2']], truncated: true });
    expect(csvPreview('a\n"unterminated').error).toContain('Unclosed');
  });
});
