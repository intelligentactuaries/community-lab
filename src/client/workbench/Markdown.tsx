// A small Markdown reader for the workspace's notes and READMEs: headings,
// paragraphs, lists, tables, fenced code, inline code, bold and links. It
// builds React elements (no HTML strings), so a note cannot inject markup;
// links open outside the app.

import type { ReactNode } from 'react';
import { desktop } from './desktop';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) out.push(<b key={k}>{tok.slice(2, -2)}</b>);
    else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm?.[2] ?? '';
      const safe = /^https?:\/\//.test(href);
      out.push(
        safe ? (
          <a
            key={k}
            href={href}
            onClick={(e) => {
              const d = desktop();
              if (d) {
                e.preventDefault();
                d.openExternal(href);
              }
            }}
            target="_blank"
            rel="noreferrer noopener"
          >
            {lm?.[1]}
          </a>
        ) : (
          <span key={k}>{lm?.[1] ?? tok}</span>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const key = () => `b${n++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key()}>{body.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const k = key();
      const content = inline(h[2], k);
      blocks.push(h[1].length === 1 ? <h1 key={k}>{content}</h1> : h[1].length === 2 ? <h2 key={k}>{content}</h2> : <h3 key={k}>{content}</h3>);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      const k = key();
      blocks.push(
        <table key={k}>
          <thead>
            <tr>{head.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      const k = key();
      blocks.push(<ul key={k}>{items.map((it, j) => <li key={j}>{inline(it, `${k}${j}`)}</li>)}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*]\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    const k = key();
    blocks.push(<p key={k}>{inline(para.join(' '), k)}</p>);
  }
  return <div className="wb-md">{blocks}</div>;
}
