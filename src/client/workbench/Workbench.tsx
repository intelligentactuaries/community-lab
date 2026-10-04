// The workbench: Community Lab IDE's second view, beside the province. A
// workspace folder in the explorer, its files in tabs (Monaco, with the
// province and experiment schemas and the script API), a Run for each kind of
// file, and the Console and Problems below. The province keeps its own clock
// while you are here (the top bar still plays and pauses it); running a
// province file takes you back to it, rebuilt.

import React, { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type FileKind, type TreeEntry, fileKind, parseJsonText, runVerb } from '../../shared/files';
import { seedYears } from '../../shared/exchange';
import { EChart } from '../charts/EChart';
import { baseOption, chartTheme } from '../charts/theme';
import { Close, Play } from '../components/Icons';
import { lab } from '../lib/lab';
import { store, useStore } from '../lib/simStore';
import { CodeEditor, cursor, disposeClosedModels } from './CodeEditor';
import { desktop, modKey } from './desktop';
import { Markdown } from './Markdown';
import { runFile } from './run';
import { type ConsoleEntry, type PlotSpec, type Problem, type Row, type Tab, saveProvinceAsScenario, useWorkspace, workspace } from './workspace';

// ── icons (the app's stroke recipe: currentColor, 24-box, 1.6) ──────────

function Svg({ size = 15, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const FolderIcon = ({ open }: { open?: boolean }) => (
  <Svg>{open ? <path d="M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 8l1.5 10a2 2 0 0 0 2 1.7h11a2 2 0 0 0 2-1.7L21 9H6" /> : <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />}</Svg>
);
function FileIcon({ kind }: { kind: FileKind }) {
  if (kind === 'province')
    return (
      <Svg>
        <circle cx="12" cy="6" r="2.2" />
        <circle cx="5.5" cy="17" r="2.2" />
        <circle cx="18.5" cy="17" r="2.2" />
        <path d="M12 8.2v4.3M10.4 13.6 7.2 15.6M13.6 13.6l3.2 2" />
        <circle cx="12" cy="13" r="1.1" fill="currentColor" stroke="none" />
      </Svg>
    );
  if (kind === 'experiment')
    return (
      <Svg>
        <path d="M9 3h6M10 3v6L4.5 18.5A1.6 1.6 0 0 0 5.9 21h12.2a1.6 1.6 0 0 0 1.4-2.5L14 9V3" />
        <path d="M7.5 15h9" />
      </Svg>
    );
  if (kind === 'script')
    return (
      <Svg>
        <path d="M8 6 3 12l5 6M16 6l5 6-5 6" />
      </Svg>
    );
  if (kind === 'csv')
    return (
      <Svg>
        <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
        <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15" />
      </Svg>
    );
  if (kind === 'markdown')
    return (
      <Svg>
        <path d="M5 5h14M5 10h14M5 15h9M5 20h6" />
      </Svg>
    );
  return (
    <Svg>
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v5h5" />
    </Svg>
  );
}
const Plus = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
const FolderPlus = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10.5v5M9.5 13h5" />
  </Svg>
);
const Refresh = () => (
  <Svg>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Svg>
);
const Collapse = () => (
  <Svg>
    <path d="m7 9 5 5 5-5" transform="rotate(180 12 11.5)" />
    <path d="M5 19h14" />
  </Svg>
);
const Stop = () => (
  <Svg>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </Svg>
);

// ── the view ────────────────────────────────────────────────────────────

export function Workbench() {
  const ws = useWorkspace();
  useEffect(() => {
    void workspace.refresh();
    // The tree follows the disk while the window is in front: a file made by another program shows up.
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) void workspace.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => disposeClosedModels(ws.tabs.map((t) => t.path)), [ws.tabs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        if (e.shiftKey) void workspace.saveAll();
        else void workspace.save();
      } else if (k === 'enter') {
        e.preventDefault();
        void runFile();
      } else if (k === 'b') {
        e.preventDefault();
        workspace.setExplorer(!workspace.state.explorerOpen);
      } else if (k === 'j') {
        e.preventDefault();
        workspace.setPanel(workspace.state.panel ? null : 'console');
      } else if (k === 'w' && workspace.state.active) {
        e.preventDefault();
        workspace.requestClose(workspace.state.active);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [sizes, setSizes] = useSizes();
  const gridRef = useRef<HTMLDivElement | null>(null);
  if (!ws.loaded) return <div className="workbench wb-loading muted">Opening the workspace…</div>;
  if (!ws.root) return <Welcome />;
  return (
    <div ref={gridRef} className={`workbench ${ws.explorerOpen ? '' : 'no-explorer'} ${ws.panel ? '' : 'no-panel'}`} style={{ '--wb-explorer': `${sizes.explorer}px`, '--wb-panel': `${sizes.panel}%` } as React.CSSProperties}>
      {ws.explorerOpen && <Explorer splitter={<Splitter axis="x" grid={gridRef} onDrag={(x) => setSizes({ ...sizes, explorer: Math.round(Math.max(180, Math.min(520, x))) })} />} />}
      <EditorArea />
      {ws.panel && (
        <BottomPanel
          splitter={
            <Splitter
              axis="y"
              grid={gridRef}
              // The panel's row is a share of the whole grid (the status bar's 24 px included): from the pointer down to the status bar.
              onDrag={(y, h) => setSizes({ ...sizes, panel: Math.max(14, Math.min(72, Math.round(((h - 24 - y) / h) * 1000) / 10)) })}
            />
          }
        />
      )}
      <StatusBar />
      {ws.closing && <CloseDialog path={ws.closing} />}
    </div>
  );
}

// ── resizing: the explorer's width and the panel's height, dragged and remembered ──

const SIZES_KEY = 'community-lab:workbench-sizes:v1';
function useSizes(): [{ explorer: number; panel: number }, (s: { explorer: number; panel: number }) => void] {
  const [sizes, setSizes] = useState<{ explorer: number; panel: number }>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') as { explorer?: number; panel?: number };
      return { explorer: typeof s.explorer === 'number' ? s.explorer : 252, panel: typeof s.panel === 'number' ? s.panel : 34 };
    } catch {
      return { explorer: 252, panel: 34 };
    }
  });
  const save = (s: { explorer: number; panel: number }) => {
    setSizes(s);
    try {
      localStorage.setItem(SIZES_KEY, JSON.stringify(s));
    } catch {
      /* no storage */
    }
  };
  return [sizes, save];
}

/** A divider to drag. x: the pointer's distance from the grid's left edge; y: from its top, with the grid's height. */
function Splitter({ axis, grid, onDrag }: { axis: 'x' | 'y'; grid: React.RefObject<HTMLDivElement | null>; onDrag: (pos: number, size: number) => void }) {
  return (
    <div
      className={`wb-splitter ${axis}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      onPointerDown={(e) => {
        const el = grid.current;
        if (!el) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const move = (ev: PointerEvent) => (axis === 'x' ? onDrag(ev.clientX - r.left, r.width) : onDrag(ev.clientY - r.top, r.height));
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          document.body.classList.remove('wb-dragging', axis);
        };
        document.body.classList.add('wb-dragging', axis);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}

// ── welcome: no workspace yet ───────────────────────────────────────────

function Welcome() {
  const ws = useWorkspace();
  const d = desktop();
  const [parent, setParent] = useState('');
  const [path, setPath] = useState('');
  const where = parent || ws.suggested;
  return (
    <div className="workbench wb-welcome scroll">
      <div className="wb-welcome-inner">
        <div className="panel-label">Workbench</div>
        <h1>A province you can program.</h1>
        <p className="muted">
          A workspace is a folder of ordinary files: provinces to run (<code>.province.json</code>), paired experiments for the worker pool (<code>.experiment.json</code>), scripts with the engine at hand (<code>.js</code>), mortality tables, results and notes. Version it with git, share it, open it again
          tomorrow.
        </p>
        {ws.error && <div className="small err">{ws.error}</div>}
        <div className="wb-start">
          <section>
            <h2>Start from the sample</h2>
            <p className="small muted">Four provinces, two experiments, four scripts and a mortality table to live on, every one runnable. It goes in a new folder:</p>
            <label className="small muted">
              In
              <input value={parent} placeholder={ws.suggested} onChange={(e) => setParent(e.target.value)} spellCheck={false} />
            </label>
            <div className="row">
              <button type="button" className="primary" onClick={() => void workspace.create(parent || undefined)}>
                Create the sample workspace
              </button>
              {d && (
                <button
                  type="button"
                  className="ghost"
                  onClick={async () => {
                    const p = await d.pickFolder({ title: 'Where should the workspace go?', defaultPath: where });
                    if (p) setParent(p);
                  }}
                >
                  Choose…
                </button>
              )}
            </div>
          </section>
          <section>
            <h2>Open a folder</h2>
            <p className="small muted">Any folder works; the explorer shows its files and the kinds the IDE can run.</p>
            {d ? (
              <button type="button" onClick={() => void workspace.pickAndOpen()}>
                Open a folder…
              </button>
            ) : (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (path.trim()) void workspace.open(path.trim());
                }}
              >
                <input className="grow" value={path} placeholder={`${ws.home}/…`} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
                <button type="submit" disabled={!path.trim()}>
                  Open
                </button>
              </form>
            )}
            {ws.recent.length > 0 && (
              <div className="wb-recent">
                <div className="panel-label">Recent</div>
                {ws.recent.map((r) => (
                  <button key={r} type="button" className="ghost" title={r} onClick={() => void workspace.open(r)}>
                    {r.split(/[\\/]/).pop()} <span className="muted">{r}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── explorer ────────────────────────────────────────────────────────────

function Explorer({ splitter }: { splitter?: ReactNode }) {
  const ws = useWorkspace();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const d = desktop();
  return (
    <aside className="wb-explorer">
      {splitter}
      <div className="wb-explorer-head">
        <span className="panel-label" title={ws.root ?? ''}>
          {ws.name}
        </span>
        <span className="grow" />
        <div className="wb-new">
          <button type="button" className="icon" title="New file" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Plus />
          </button>
          {menu && (
            <div className="wb-menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {(
                [
                  ['province', 'Province', 'a seed and a basis to run'],
                  ['experiment', 'Experiment', 'arms against a baseline, on the pool'],
                  ['script', 'Script', 'JavaScript with the engine at hand'],
                  ['note', 'Note', 'Markdown'],
                ] as const
              ).map(([k, label, hint]) => (
                <button
                  key={k}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    void workspace.newFile(k);
                  }}
                >
                  {label} <span className="muted">{hint}</span>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  void saveProvinceAsScenario().catch((e) => workspace.log('error', e instanceof Error ? e.message : String(e)));
                }}
              >
                The province on screen <span className="muted">as a province file</span>
              </button>
            </div>
          )}
        </div>
        <button type="button" className="icon" title="New folder" onClick={() => setNewFolder(true)}>
          <FolderPlus />
        </button>
        <button type="button" className="icon" title="Refresh" onClick={() => void workspace.refresh()}>
          <Refresh />
        </button>
        <button type="button" className="icon" title="Collapse folders" onClick={() => workspace.collapseAll()}>
          <Collapse />
        </button>
      </div>
      <div className="wb-tree scroll" role="tree">
        {newFolder && (
          <NameInput
            initial="new folder"
            onDone={(name) => {
              setNewFolder(false);
              if (name) void workspace.newFolder('', name);
            }}
          />
        )}
        <TreeLevel entries={ws.tree} depth={0} renaming={renaming} setRenaming={setRenaming} />
        {ws.truncated && <div className="small muted wb-pad">The folder is large: the tree stops at a few thousand entries.</div>}
        {!ws.tree.length && <div className="small muted wb-pad">An empty folder. Make a file with +.</div>}
      </div>
      <div className="wb-explorer-foot">
        {d && (
          <button type="button" className="ghost" onClick={() => workspace.reveal('')} title={ws.root ?? ''}>
            Show in folder
          </button>
        )}
        <button type="button" className="ghost" onClick={() => void (d ? workspace.pickAndOpen() : workspace.close())}>
          {d ? 'Open another…' : 'Close'}
        </button>
      </div>
    </aside>
  );
}

function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the stem, not the extension (".province.json" stays as it is).
    const dot = initial.search(/\.(province|experiment)\.json$|\.[^.]+$/);
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <input
      ref={ref}
      className="wb-rename"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim() && !/[\\/]/.test(v) ? v.trim() : null);
        if (e.key === 'Escape') onDone(null);
      }}
      onBlur={() => onDone(null)}
      spellCheck={false}
    />
  );
}

function TreeLevel({ entries, depth, renaming, setRenaming }: { entries: TreeEntry[]; depth: number; renaming: string | null; setRenaming: (p: string | null) => void }) {
  const ws = useWorkspace();
  const problemsBy = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const p of ws.problems) if (p.severity !== 'info') m.set(p.path, m.get(p.path) === 'error' ? 'error' : (p.severity as 'error' | 'warning'));
    return m;
  }, [ws.problems]);
  return (
    <>
      {entries.map((e) => {
        const open = !!ws.expanded[e.path];
        const kind = fileKind(e.path);
        const dirty = ws.tabs.find((t) => t.path === e.path && t.text !== t.saved);
        const flag = problemsBy.get(e.path);
        return (
          <div key={e.path} role="treeitem" aria-expanded={e.kind === 'dir' ? open : undefined}>
            {renaming === e.path ? (
              <div style={{ paddingLeft: 8 + depth * 14 }}>
                <NameInput
                  initial={e.name}
                  onDone={(name) => {
                    setRenaming(null);
                    if (name && name !== e.name) void workspace.rename(e.path, name);
                  }}
                />
              </div>
            ) : (
              <div
                className={`wb-node ${e.kind} ${ws.active === e.path ? 'on' : ''} ${flag ?? ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => (e.kind === 'dir' ? workspace.toggleFolder(e.path) : void workspace.openFile(e.path))}
                onDoubleClick={() => e.kind === 'file' && runVerb(kind) === null && void workspace.openFile(e.path)}
                title={e.path}
              >
                <span className="wb-ico">{e.kind === 'dir' ? <FolderIcon open={open} /> : <FileIcon kind={kind} />}</span>
                <span className="wb-name">{e.name}</span>
                {dirty && <span className="wb-dot" title="Unsaved changes" />}
                <span className="wb-node-tools">
                  {e.kind === 'file' && runVerb(kind) && (
                    <button
                      type="button"
                      className="icon"
                      title={runVerb(kind) ?? ''}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void workspace.openFile(e.path).then(() => runFile(e.path));
                      }}
                    >
                      <Play size={11} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon"
                    title="Rename"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setRenaming(e.path);
                    }}
                  >
                    <Svg size={13}>
                      <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
                    </Svg>
                  </button>
                  <button
                    type="button"
                    className="icon"
                    title={desktop() ? 'Move to the trash' : "Move to the IDE's trash"}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (window.confirm(`Move ${e.path} to the trash?`)) void workspace.remove(e.path);
                    }}
                  >
                    <Svg size={13}>
                      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                    </Svg>
                  </button>
                </span>
              </div>
            )}
            {e.kind === 'dir' && open && e.children && <TreeLevel entries={e.children} depth={depth + 1} renaming={renaming} setRenaming={setRenaming} />}
          </div>
        );
      })}
    </>
  );
}

// ── the editor area ─────────────────────────────────────────────────────

function EditorArea() {
  const ws = useWorkspace();
  const tab = ws.tabs.find((t) => t.path === ws.active) ?? null;
  const [reveal, setReveal] = useState<{ line: number; at: number } | null>(null);
  revealHook.current = (line: number) => setReveal({ line, at: Date.now() });
  return (
    <section className="wb-editor">
      <div className="wb-tabs" role="tablist">
        {ws.tabs.map((t) => (
          <div key={t.path} role="tab" aria-selected={t.path === ws.active} className={`wb-tab ${t.path === ws.active ? 'on' : ''}`} onClick={() => workspace.activate(t.path)} onAuxClick={(e) => e.button === 1 && workspace.requestClose(t.path)} title={t.path}>
            <span className="wb-ico">
              <FileIcon kind={t.kind} />
            </span>
            <span className="wb-name">{t.path.split('/').pop()}</span>
            {t.text !== t.saved ? <span className="wb-dot" title="Unsaved changes" /> : null}
            <button
              type="button"
              className="icon wb-tab-x"
              title={`Close (${modKey()}+W)`}
              onClick={(e) => {
                e.stopPropagation();
                workspace.requestClose(t.path);
              }}
            >
              <Close size={11} />
            </button>
          </div>
        ))}
      </div>
      {tab ? <FileView tab={tab} reveal={reveal} /> : <EmptyEditor />}
    </section>
  );
}

const revealHook: { current: ((line: number) => void) | null } = { current: null };

function EmptyEditor() {
  const m = modKey();
  return (
    <div className="wb-empty">
      <div className="panel-label">No file open</div>
      <table className="wb-keys">
        <tbody>
          <tr>
            <td>Run the file</td>
            <td>
              <kbd>{m}</kbd> <kbd>Enter</kbd>
            </td>
          </tr>
          <tr>
            <td>Save</td>
            <td>
              <kbd>{m}</kbd> <kbd>S</kbd>
            </td>
          </tr>
          <tr>
            <td>Explorer</td>
            <td>
              <kbd>{m}</kbd> <kbd>B</kbd>
            </td>
          </tr>
          <tr>
            <td>Console</td>
            <td>
              <kbd>{m}</kbd> <kbd>J</kbd>
            </td>
          </tr>
          <tr>
            <td>Province · Workbench</td>
            <td>
              <kbd>{m}</kbd> <kbd>1</kbd> · <kbd>{m}</kbd> <kbd>2</kbd>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FileView({ tab, reveal }: { tab: Tab; reveal: { line: number; at: number } | null }) {
  const ws = useWorkspace();
  const [preview, setPreview] = useState<Record<string, boolean>>({});
  const previewable = tab.kind === 'markdown' || tab.kind === 'csv';
  // READMEs and tables open as they read; anything else opens as text.
  const showPreview = previewable && (preview[tab.path] ?? (tab.kind === 'csv' || /readme\.md$/i.test(tab.path)));
  const verb = runVerb(tab.kind);
  const running = ws.running?.path === tab.path;
  return (
    <div className="wb-file">
      <div className="wb-toolbar">
        <span className="small muted wb-crumbs">{tab.path.split('/').join('  ›  ')}</span>
        <span className="grow" />
        <KindHint tab={tab} />
        {previewable && (
          <button type="button" className="ghost" onClick={() => setPreview({ ...preview, [tab.path]: !showPreview })}>
            {showPreview ? 'Edit as text' : tab.kind === 'csv' ? 'Show as a table' : 'Preview'}
          </button>
        )}
        {tab.kind === 'experiment' && (
          <button type="button" className="ghost" title="Show it in the policy lab without running it" onClick={() => openInLab(tab)}>
            Open in the lab
          </button>
        )}
        {tab.text !== tab.saved && (
          <button type="button" className="ghost" onClick={() => void workspace.save(tab.path)} title={`${modKey()}+S`}>
            Save
          </button>
        )}
        {verb &&
          (running ? (
            <button type="button" onClick={() => workspace.stop()} title="Stop the run">
              <Stop /> Stop
            </button>
          ) : (
            <button type="button" className="primary wb-run" disabled={!!ws.running || tab.status !== 'ready'} onClick={() => void runFile(tab.path)} title={`${verb} (${modKey()}+Enter)`}>
              <Play size={12} /> {verb}
            </button>
          ))}
      </div>
      {tab.conflict && (
        <div className="wb-banner">
          <span>
            <b>{tab.path}</b> changed on disk since it was opened.
          </span>
          <button type="button" onClick={() => void workspace.reload(tab.path)}>
            Reload from disk
          </button>
          <button type="button" className="ghost" onClick={() => void workspace.save(tab.path, true)}>
            Keep mine and overwrite
          </button>
        </div>
      )}
      {tab.status === 'loading' && <div className="wb-pad muted">Reading…</div>}
      {tab.status === 'error' && <div className="wb-pad err">{tab.error}</div>}
      {tab.status === 'ready' && (showPreview ? <Preview tab={tab} /> : <CodeEditor tab={tab} revealLine={reveal} />)}
    </div>
  );
}

function openInLab(tab: Tab): void {
  const j = parseJsonText(tab.text);
  if (!j.ok) {
    workspace.log('error', `${tab.path}: ${j.error}`);
    return;
  }
  const { $schema: _s, notes: _n, ...spec } = j.value as Record<string, unknown>;
  lab.open(spec as never, tab.path);
  store.setView('province');
  store.openDrawer('lab');
}

/** One line under the tabs that says what this file will do when run. */
function KindHint({ tab }: { tab: Tab }) {
  const st = useStore();
  if (tab.kind === 'experiment') {
    const j = parseJsonText(tab.text);
    if (!j.ok) return null;
    const s = j.value as { seeds?: number; years?: number; arms?: unknown[] };
    if (typeof s.seeds !== 'number' || typeof s.years !== 'number' || !Array.isArray(s.arms)) return null;
    const runs = s.seeds * (s.arms.length + 1);
    const minutes = Math.max(1, Math.round((Math.ceil(runs / 8) * s.years * 10) / 60));
    return (
      <span className="small muted">
        {runs} runs × {s.years} years · {seedYears(s.seeds, s.years, s.arms.length + 1)} province-years · about {minutes} min
      </span>
    );
  }
  if (tab.kind === 'province') return <span className="small muted">replaces the province on screen (seed {st.params.seed} now)</span>;
  if (tab.kind === 'script') return <span className="small muted">runs beside the editor; the province on screen is untouched</span>;
  return null;
}

function Preview({ tab }: { tab: Tab }) {
  if (tab.kind === 'markdown')
    return (
      <div className="wb-preview scroll">
        <Markdown text={tab.text} />
      </div>
    );
  const rows = tab.text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length);
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) {
        if (c === '"' && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t' || c === ';') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = rows.length ? split(rows[0]) : [];
  const body = rows.slice(1, 501).map(split);
  return (
    <div className="wb-preview scroll">
      <div className="small muted wb-pad">
        {(rows.length - 1).toLocaleString('en-GB')} rows × {head.length} columns{rows.length > 501 ? '; the first 500 shown' : ''}
      </div>
      <table className="wb-grid">
        <thead>
          <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={c !== '' && Number.isFinite(Number(c)) ? 'n' : ''}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CloseDialog({ path }: { path: string }) {
  return (
    <div className="wb-modal" role="dialog" aria-modal="true" aria-label="Unsaved changes">
      <div className="wb-modal-box">
        <b>Save the changes to {path.split('/').pop()}?</b>
        <p className="small muted">Otherwise they are lost when the tab closes.</p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={async () => {
              if (await workspace.save(path)) workspace.closeTab(path);
              else workspace.cancelClose();
            }}
          >
            Save
          </button>
          <button type="button" onClick={() => workspace.closeTab(path)}>
            Don't save
          </button>
          <span className="grow" />
          <button type="button" className="ghost" onClick={() => workspace.cancelClose()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Console and Problems ────────────────────────────────────────────────

function BottomPanel({ splitter }: { splitter?: ReactNode }) {
  const ws = useWorkspace();
  const errors = ws.problems.filter((p) => p.severity === 'error').length;
  const warnings = ws.problems.filter((p) => p.severity === 'warning').length;
  return (
    <section className="wb-panel">
      {splitter}
      <div className="wb-panel-head">
        <button type="button" className={`wb-ptab ${ws.panel === 'console' ? 'on' : ''}`} onClick={() => workspace.setPanel('console')}>
          Console
        </button>
        <button type="button" className={`wb-ptab ${ws.panel === 'problems' ? 'on' : ''}`} onClick={() => workspace.setPanel('problems')}>
          Problems {errors + warnings > 0 && <span className={`wb-count ${errors ? 'err' : 'warn'}`}>{errors + warnings}</span>}
        </button>
        <span className="grow" />
        {ws.running && (
          <span className="small muted wb-running">
            <span className="led busy" /> running {ws.running.path}
            <button type="button" className="ghost" onClick={() => workspace.stop()}>
              Stop
            </button>
          </span>
        )}
        {ws.panel === 'console' && (
          <button type="button" className="ghost" onClick={() => workspace.clearConsole()}>
            Clear
          </button>
        )}
        <button type="button" className="icon" title={`Hide the panel (${modKey()}+J)`} onClick={() => workspace.setPanel(null)}>
          <Close size={12} />
        </button>
      </div>
      {ws.panel === 'console' ? <ConsoleView entries={ws.console} /> : <ProblemsView problems={ws.problems} />}
    </section>
  );
}

function ConsoleView({ entries }: { entries: ConsoleEntry[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries]);
  return (
    <div
      ref={ref}
      className="wb-console scroll"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {!entries.length && <div className="muted small wb-pad">Output from runs appears here: what a script prints, its tables and plots, an experiment's progress and effects.</div>}
      {entries.map((e) => (
        <ConsoleLine key={e.id} e={e} />
      ))}
    </div>
  );
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    // Not a number is "no estimate" (too few deaths for a life expectancy, say), shown as a dash.
    if (Number.isNaN(v)) return '—';
    if (!Number.isFinite(v)) return String(v);
    if (Number.isInteger(v)) return v.toLocaleString('en-GB');
    const a = Math.abs(v);
    return a >= 1000 ? v.toLocaleString('en-GB', { maximumFractionDigits: 1 }) : a >= 1 ? v.toFixed(3) : a === 0 ? '0' : v.toPrecision(3);
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

function ConsoleLine({ e }: { e: ConsoleEntry }) {
  switch (e.kind) {
    case 'run':
      return (
        <div className="wb-c-run">
          <Play size={10} /> <b>{e.path}</b> <span className="muted">{e.verb}</span>
        </div>
      );
    case 'log':
      return <pre className={`wb-c-log ${e.level}`}>{e.text}</pre>;
    case 'table':
      return <ConsoleTable rows={e.rows} columns={e.columns} />;
    case 'plot':
      return <ConsolePlot spec={e.spec} />;
    case 'progress':
      return (
        <div className={`wb-c-progress ${e.finished ? 'finished' : ''}`}>
          <span className="small">{e.label}</span>
          <div className="progress">
            <i style={{ width: `${(e.done / Math.max(1, e.total)) * 100}%` }} />
          </div>
          <span className="small muted">
            {e.done.toLocaleString('en-GB')}/{e.total.toLocaleString('en-GB')}
          </span>
        </div>
      );
    case 'done':
      return (
        <div className={`wb-c-done ${e.ok ? 'ok' : 'err'}`}>
          {e.text ?? (e.ok ? 'Done.' : 'Failed.')} {e.ms > 0 && <span className="muted">{e.ms < 2000 ? `${e.ms} ms` : `${(e.ms / 1000).toFixed(1)} s`}</span>}
        </div>
      );
    case 'action':
      return (
        <div className="wb-c-action small">
          <span className="muted">{e.text}</span>
          <button type="button" onClick={e.act}>
            {e.label}
          </button>
        </div>
      );
  }
}

function ConsoleTable({ rows, columns }: { rows: Row[]; columns: string[] }) {
  return (
    <div className="wb-c-table scroll">
      <table className="wb-grid">
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className={typeof r[c] === 'number' ? 'n' : ''}>
                  {fmtCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsolePlot({ spec }: { spec: PlotSpec }) {
  const th = chartTheme();
  const base = baseOption(th) as Record<string, Record<string, unknown>>;
  const numericX = spec.x.every((x) => typeof x === 'number');
  const names = Object.keys(spec.series);
  const option = {
    ...base,
    title: spec.title ? { text: spec.title, left: 0, top: 0, textStyle: { color: th.fg, fontSize: 12, fontWeight: 500, fontFamily: th.font } } : undefined,
    legend: names.length > 1 ? { ...base.legend, top: 0, right: 0 } : { show: false },
    grid: { left: 10, right: 20, top: spec.title || names.length > 1 ? 30 : 12, bottom: spec.xLabel ? 22 : 8, containLabel: true },
    xAxis: numericX ? { ...base.xAxis, type: 'value', name: spec.xLabel, nameLocation: 'middle', nameGap: 24, min: 'dataMin', max: 'dataMax' } : { ...base.xAxis, type: 'category', data: spec.x, name: spec.xLabel, nameLocation: 'middle', nameGap: 24 },
    yAxis: { ...base.yAxis, type: spec.log ? 'log' : 'value', name: spec.yLabel, nameTextStyle: { color: th.muted, fontSize: 10 }, scale: !spec.log },
    series: names.map((name, i) => ({
      name,
      type: 'line',
      showSymbol: spec.x.length <= 40,
      symbol: 'circle',
      symbolSize: 5,
      connectNulls: false,
      lineStyle: { width: 1.8 },
      color: th.categorical[i % th.categorical.length],
      data: numericX ? spec.x.map((x, j) => [x, spec.log && (spec.series[name][j] ?? 0) <= 0 ? null : spec.series[name][j]]) : spec.series[name].map((y) => (spec.log && (y ?? 0) <= 0 ? null : y)),
    })),
  };
  return (
    <div className="wb-c-plot">
      <EChart option={option} className="wb-c-chart" />
    </div>
  );
}

function ProblemsView({ problems }: { problems: Problem[] }) {
  if (!problems.length) return <div className="muted small wb-pad">No problems: every open file parses, and the last runs applied cleanly.</div>;
  const sorted = [...problems].sort((a, b) => (a.severity === b.severity ? a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) : a.severity === 'error' ? -1 : 1));
  return (
    <div className="wb-problems scroll">
      {sorted.map((p, i) => (
        <button
          key={i}
          type="button"
          className={`wb-problem ${p.severity}`}
          onClick={async () => {
            await workspace.openFile(p.path);
            if (p.line) setTimeout(() => revealHook.current?.(p.line as number), 50);
          }}
        >
          <span className={`led ${p.severity === 'error' ? 'down' : 'busy'}`} />
          <span className="grow">{p.message}</span>
          <span className="muted small">
            {p.path}
            {p.line ? `:${p.line}` : ''} · {p.source === 'editor' ? 'editor' : 'run'}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── status bar ──────────────────────────────────────────────────────────

function StatusBar() {
  const ws = useWorkspace();
  const st = useStore();
  const tab = ws.tabs.find((t) => t.path === ws.active) ?? null;
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    cursor.listeners.add(fn);
    return () => {
      cursor.listeners.delete(fn);
    };
  }, []);
  const cal = st.cal();
  const residents = useMemo(() => Object.values(st.sim.world.people).filter((p) => p.alive && !p.emigrated).length, [st.sim.world.day, st.sim]);
  return (
    <footer className="wb-status">
      <span title={ws.root ?? ''}>{ws.name}</span>
      {tab && (
        <span className="muted">
          {tab.kind === 'province' ? 'province' : tab.kind === 'experiment' ? 'experiment' : tab.kind === 'script' ? 'script · JavaScript' : tab.kind}
        </span>
      )}
      {tab && <span className="muted">Ln {cursor.line}, Col {cursor.col}</span>}
      <span className="grow" />
      <button type="button" className="wb-status-link" onClick={() => store.setView('province')} title="Show the province">
        <span className={`led ${st.running ? 'live' : ''}`} /> {st.params.regionName} Province · {cal.isoDate} · {residents} residents · {st.running ? st.speed.label : 'paused'}
      </button>
    </footer>
  );
}

export default Workbench;
