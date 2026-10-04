// Monaco, configured once and offline: its workers bundled by Vite (no CDN),
// the province and experiment schemas on their files, the script API's
// declarations on every script, and two themes in the app's own palette
// (the Scelo family's warm cream and warm charcoal).

import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';
import { EXPERIMENT_SCHEMA_URI, PROVINCE_SCHEMA_URI } from '../../shared/files';
import { EXPERIMENT_SCHEMA, PROVINCE_SCHEMA } from './schema';
import { SCRIPT_API_DTS } from './scriptApi';

// Monaco cancels its own pending requests when a model changes or closes, and lets the rejection go unhandled;
// it is not an error (Monaco's own advice is to ignore it), so it is kept out of the console.
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { name?: string; message?: string } | null;
  if (r && (r.name === 'Canceled' || r.message === 'Canceled')) e.preventDefault();
});

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

monaco.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  trailingCommas: 'error',
  enableSchemaRequest: false,
  schemas: [
    { uri: PROVINCE_SCHEMA_URI, fileMatch: ['*.province.json'], schema: PROVINCE_SCHEMA },
    { uri: EXPERIMENT_SCHEMA_URI, fileMatch: ['*.experiment.json'], schema: EXPERIMENT_SCHEMA },
  ],
});

const js = monaco.typescript.javascriptDefaults;
js.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ES2020,
  module: monaco.typescript.ModuleKind.ESNext,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: true,
  strict: false,
  noImplicitAny: false,
  lib: ['es2022'],
  // A script is the body of an async function: top-level await is allowed, and so is a top-level return.
  moduleDetection: 3,
});
js.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  // 1108: a return outside a function (allowed in a script); 1375/1378: top-level await outside a module.
  diagnosticCodesToIgnore: [1108, 1375, 1378, 80001, 80004, 7044],
});
js.addExtraLib(SCRIPT_API_DTS, 'file:///community-lab-script-api.d.ts');

/** The palette, read from the page's own tokens so the editor follows the theme (and the day-night blend). */
function defineThemes(): void {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => {
    const raw = css.getPropertyValue(name).trim();
    return toHex(raw) ?? fallback;
  };
  const light: monaco.editor.IStandaloneThemeData = {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8A8377' },
      { token: 'keyword', foreground: '26714C' },
      { token: 'string', foreground: '8E5823' },
      { token: 'string.key.json', foreground: '345DCB' },
      { token: 'string.value.json', foreground: '8E5823' },
      { token: 'number', foreground: 'B43939' },
      { token: 'identifier', foreground: '181715' },
      { token: 'type', foreground: '345DCB' },
    ],
    colors: {
      'editor.background': v('--bg-2', '#F2EEE2'),
      'editor.foreground': '#181715',
      'editorLineNumber.foreground': '#A39C8E',
      'editorLineNumber.activeForeground': '#45423D',
      'editor.lineHighlightBackground': '#E8E4D8',
      'editor.selectionBackground': '#26714C33',
      'editorCursor.foreground': '#26714C',
      'editorIndentGuide.background1': '#DAD5C6',
      'editorWidget.background': '#F2EEE2',
      'editorWidget.border': '#CDC7B8',
      'editorSuggestWidget.background': '#F2EEE2',
      'editorSuggestWidget.selectedBackground': '#E8E4D8',
      'editorHoverWidget.background': '#F2EEE2',
      'scrollbarSlider.background': '#605A5122',
      'scrollbarSlider.hoverBackground': '#605A5144',
    },
  };
  const dark: monaco.editor.IStandaloneThemeData = {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8C8478' },
      { token: 'keyword', foreground: '82D7AF' },
      { token: 'string', foreground: 'EBB46E' },
      { token: 'string.key.json', foreground: '82A0E6' },
      { token: 'string.value.json', foreground: 'EBB46E' },
      { token: 'number', foreground: 'E66E6E' },
      { token: 'identifier', foreground: 'F1ECDF' },
      { token: 'type', foreground: '82A0E6' },
    ],
    colors: {
      'editor.background': v('--bg-2', '#221E1A'),
      'editor.foreground': '#F1ECDF',
      'editorLineNumber.foreground': '#6E675C',
      'editorLineNumber.activeForeground': '#BEB8AD',
      'editor.lineHighlightBackground': '#2C2721',
      'editor.selectionBackground': '#82D7AF33',
      'editorCursor.foreground': '#82D7AF',
      'editorIndentGuide.background1': '#2C2721',
      'editorWidget.background': '#221E1A',
      'editorWidget.border': '#423A31',
      'editorSuggestWidget.background': '#221E1A',
      'editorSuggestWidget.selectedBackground': '#2C2721',
      'editorHoverWidget.background': '#221E1A',
      'scrollbarSlider.background': '#978F8222',
      'scrollbarSlider.hoverBackground': '#978F8244',
    },
  };
  monaco.editor.defineTheme('community-light', light);
  monaco.editor.defineTheme('community-dark', dark);
}

/** `rgb(…)`, `#rrggbb` or a color-mix the browser has resolved → `#rrggbb`. */
function toHex(raw: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  const probe = document.createElement('span');
  probe.style.color = raw;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

defineThemes();

export function themeName(): string {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'community-dark' : 'community-light';
}

/** Re-read the palette and re-apply the theme (the theme switch, or the day-night blend crossing its midpoint). */
export function refreshTheme(): void {
  defineThemes();
  monaco.editor.setTheme(themeName());
}

export { monaco };
