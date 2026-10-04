// One Monaco editor for every open file: each tab is a model (its URI ends in
// the file's own name, so the province and experiment schemas find their
// files), and switching tabs swaps the model and restores where you were.
// The editor's checks (JSON schema, JavaScript) flow into the Problems list.

import { useEffect, useRef } from 'react';
import { useTheme } from '../lib/theme';
import { monaco, refreshTheme, themeName } from './monacoSetup';
import { runFile } from './run';
import { type Tab, workspace } from './workspace';

const uriOf = (path: string) => monaco.Uri.parse(`file:///workspace/${path.split('/').map(encodeURIComponent).join('/')}`);
const pathOf = (uri: monaco.Uri) =>
  uri.path
    .replace(/^\/workspace\//, '')
    .split('/')
    .map(decodeURIComponent)
    .join('/');

function language(tab: Tab): string {
  if (tab.kind === 'province' || tab.kind === 'experiment' || tab.kind === 'json') return 'json';
  if (tab.kind === 'script') return 'javascript';
  if (tab.kind === 'markdown') return 'markdown';
  return 'plaintext';
}

const views = new Map<string, monaco.editor.ICodeEditorViewState | null>();

/** Line and column of the cursor, for the status bar. */
export const cursor = { line: 1, col: 1, listeners: new Set<() => void>() };

export function CodeEditor({ tab, revealLine }: { tab: Tab; revealLine?: { line: number; at: number } | null }) {
  const host = useRef<HTMLDivElement | null>(null);
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const current = useRef<string | null>(null);
  const { resolved } = useTheme();

  useEffect(() => {
    if (!host.current) return;
    const editor = monaco.editor.create(host.current, {
      theme: themeName(),
      automaticLayout: true,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'off',
      padding: { top: 10, bottom: 10 },
      smoothScrolling: true,
      fixedOverflowWidgets: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      bracketPairColorization: { enabled: false },
      guides: { indentation: true },
    });
    ed.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (current.current) void workspace.save(current.current);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (current.current) void runFile(current.current);
    });
    // Stop, as the Run menu says (Monaco would otherwise insert a line above).
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => workspace.stop());
    const sub = editor.onDidChangeModelContent(() => {
      const m = editor.getModel();
      if (m && current.current) workspace.setText(current.current, m.getValue());
    });
    const cur = editor.onDidChangeCursorPosition((e) => {
      cursor.line = e.position.lineNumber;
      cursor.col = e.position.column;
      for (const fn of cursor.listeners) fn();
    });
    return () => {
      sub.dispose();
      cur.dispose();
      if (current.current) views.set(current.current, editor.saveViewState());
      editor.dispose();
      ed.current = null;
      // A new editor (React mounts effects twice in development) must be given the model again.
      current.current = null;
    };
  }, []);

  // The tab's model: made on first sight, kept in step when the text changes from outside (a reload).
  useEffect(() => {
    const editor = ed.current;
    if (!editor) return;
    const uri = uriOf(tab.path);
    let model = monaco.editor.getModel(uri);
    if (!model) model = monaco.editor.createModel(tab.text, language(tab), uri);
    else if (model.getValue() !== tab.text) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: tab.text }], () => null);
    if (current.current !== tab.path) {
      if (current.current) views.set(current.current, editor.saveViewState());
      current.current = tab.path;
      editor.setModel(model);
      const v = views.get(tab.path);
      if (v) editor.restoreViewState(v);
      editor.focus();
    }
  }, [tab.path, tab.text]);

  useEffect(() => {
    if (!revealLine || !ed.current) return;
    ed.current.revealLineInCenter(revealLine.line);
    ed.current.setPosition({ lineNumber: revealLine.line, column: 1 });
    ed.current.focus();
  }, [revealLine]);

  useEffect(() => {
    refreshTheme();
  }, [resolved]);

  return <div ref={host} className="wb-monaco" />;
}

// The editor's own checks, as Problems: every model's markers, filed under its file.
monaco.editor.onDidChangeMarkers((uris) => {
  for (const uri of uris) {
    if (!uri.path.startsWith('/workspace/')) continue;
    const path = pathOf(uri);
    const markers = monaco.editor.getModelMarkers({ resource: uri });
    workspace.setProblems(
      path,
      'editor',
      markers
        .filter((m) => m.severity >= monaco.MarkerSeverity.Warning)
        .map((m) => ({ severity: m.severity >= monaco.MarkerSeverity.Error ? ('error' as const) : ('warning' as const), message: m.message, line: m.startLineNumber, col: m.startColumn })),
    );
  }
});

/** Drop the models of tabs that have closed (their markers go with them). */
export function disposeClosedModels(open: string[]): void {
  for (const m of monaco.editor.getModels()) {
    if (!m.uri.path.startsWith('/workspace/')) continue;
    const p = pathOf(m.uri);
    if (!open.includes(p)) {
      m.dispose();
      views.delete(p);
    }
  }
}
