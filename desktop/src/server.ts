// The engine's server, started with the app and stopped with it. It is
// Community Lab's own Bun server (../../src/server), compiled into one
// executable by scripts/bundle-server.sh and shipped in
// <resources>/server/, with the built client beside it; it serves the API and
// the client on one loopback origin, which is what the window loads.
//
// The IDE never adopts a server it finds running: it starts its own, on the
// first free port from 3040, so two copies (or Scelo IDE's bundled Community
// Lab on 3020) never share one. In a checkout with nothing bundled it runs
// `bun ../src/server/index.ts` against the built client in ../dist instead.
//
// A crash restarts it, up to three times with a growing pause; after that the
// window shows why, with the end of the log, rather than a blank page.

import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

export type ServerState = 'starting' | 'running' | 'stopped' | 'error';

export interface ServerStatus {
  state: ServerState;
  url: string;
  port: number;
  pid: number | null;
  error: string | null;
  source: 'bundled' | 'source' | 'none';
  logFile: string;
  dataDir: string;
}

export interface ServerOptions {
  resourcesDir: string;
  /** The repository root, when running from a checkout. */
  repoRoot: string | null;
  userDataDir: string;
  isWin: boolean;
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

const HOST = '127.0.0.1';
const FIRST_PORT = 3040;
const MAX_RESTARTS = 3;
const LOG_LIMIT = 5 * 1024 * 1024;

export class EngineServer {
  private child: ChildProcess | null = null;
  private state: ServerState = 'stopped';
  private port = FIRST_PORT;
  private error: string | null = null;
  private restarts = 0;
  private stopping = false;
  private source: ServerStatus['source'] = 'none';
  readonly logFile: string;
  readonly dataDir: string;
  private onChange: (s: ServerStatus) => void = () => {};

  constructor(private readonly opts: ServerOptions) {
    this.dataDir = join(opts.userDataDir, 'data');
    const logDir = join(opts.userDataDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    this.logFile = join(logDir, 'server.log');
  }

  get url(): string {
    return `http://${HOST}:${this.port}`;
  }

  status(): ServerStatus {
    return { state: this.state, url: this.url, port: this.port, pid: this.child?.pid ?? null, error: this.error, source: this.source, logFile: this.logFile, dataDir: this.dataDir };
  }

  watch(fn: (s: ServerStatus) => void): void {
    this.onChange = fn;
  }

  private set(state: ServerState, error: string | null = null): void {
    this.state = state;
    this.error = error;
    this.onChange(this.status());
  }

  /** Where the server is: the bundled executable, else the source with bun. */
  private locate(): { bin: string; args: string[]; staticDir: string | null; source: ServerStatus['source'] } | null {
    const dir = join(this.opts.resourcesDir, 'server');
    const bin = join(dir, this.opts.isWin ? 'community-lab-server.exe' : 'community-lab-server');
    if (existsSync(bin)) return { bin, args: [], staticDir: existsSync(join(dir, 'ui', 'index.html')) ? join(dir, 'ui') : null, source: 'bundled' };
    if (this.opts.repoRoot) {
      const entry = join(this.opts.repoRoot, 'src', 'server', 'index.ts');
      if (existsSync(entry)) {
        const dist = join(this.opts.repoRoot, 'dist');
        return { bin: this.opts.isWin ? 'bun.exe' : 'bun', args: [entry], staticDir: existsSync(join(dist, 'index.html')) ? dist : null, source: 'source' };
      }
    }
    return null;
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.port = await freePort(FIRST_PORT);
    this.spawn();
  }

  private spawn(): void {
    const where = this.locate();
    if (!where) {
      this.source = 'none';
      this.set('error', 'The engine is missing from this installation (resources/server). Reinstall Community Lab IDE, or in a checkout run `bun run desktop:install` and `bun run build` first.');
      return;
    }
    if (!where.staticDir) {
      this.set('error', 'The client is missing: build it with `bun run build` (it goes to dist/).');
      return;
    }
    this.source = where.source;
    mkdirSync(this.dataDir, { recursive: true });
    this.rotateLog();
    const out = openSync(this.logFile, 'a');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(this.port),
      HOST,
      COMMUNITY_DATA_DIR: this.dataDir,
      COMMUNITY_STATIC_DIR: where.staticDir,
      // The model loads on the first conversation, not at start: it can hold most of a laptop GPU, which the 3D view needs.
      COMMUNITY_WARM_OLLAMA: process.env.COMMUNITY_WARM_OLLAMA ?? '0',
    };
    this.set('starting');
    this.opts.log.info(`engine: starting ${where.source} server on ${this.url} (${where.bin})`);
    const child = spawn(where.bin, where.args, { cwd: this.dataDir, env, stdio: ['ignore', out, out], windowsHide: true });
    closeSync(out);
    this.child = child;
    child.on('error', (e) => {
      this.opts.log.error('engine: could not start', e);
      this.set('error', `The engine could not start: ${e.message}`);
    });
    child.on('exit', (code, signal) => {
      this.child = null;
      if (this.stopping) {
        this.set('stopped');
        return;
      }
      this.opts.log.warn(`engine: exited (code ${code}, signal ${signal})`);
      if (this.restarts >= MAX_RESTARTS) {
        this.set('error', `The engine stopped (code ${code ?? signal}) and did not stay up after ${MAX_RESTARTS} restarts.`);
        return;
      }
      this.restarts++;
      setTimeout(() => {
        if (!this.stopping) this.spawn();
      }, 800 * this.restarts);
    });
    void this.waitHealthy(child);
  }

  private async waitHealthy(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && this.child === child) {
      try {
        const r = await fetch(`${this.url}/api/health`);
        const h = (await r.json()) as { ok?: boolean; app?: string };
        if (r.ok && h.ok && h.app === 'community-lab') {
          this.restarts = 0;
          this.set('running');
          return;
        }
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (this.child === child) this.set('error', 'The engine started but did not answer within a minute.');
  }

  /** Resolves when the server is running, or rejects with the reason it is not. */
  ready(): Promise<string> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.state === 'running') resolve(this.url);
        else if (this.state === 'error') reject(new Error(this.error ?? 'the engine failed'));
        else setTimeout(check, 100);
      };
      check();
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* gone */
        }
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(t);
        resolve();
      }
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    this.restarts = 0;
    await this.start();
  }

  logTail(bytes = 6000): string {
    try {
      const buf = readFileSync(this.logFile);
      return buf.subarray(Math.max(0, buf.length - bytes)).toString('utf8');
    } catch {
      return '';
    }
  }

  private rotateLog(): void {
    try {
      if (existsSync(this.logFile) && statSync(this.logFile).size > LOG_LIMIT) renameSync(this.logFile, `${this.logFile}.1`);
    } catch {
      /* keep appending */
    }
  }
}

/** The first port from `from` that nothing is listening on (loopback). */
export function freePort(from: number): Promise<number> {
  const tryPort = (p: number): Promise<number> =>
    new Promise((resolve) => {
      const srv = createServer();
      srv.once('error', () => resolve(p < from + 200 ? tryPort(p + 1) : Promise.resolve(0)));
      srv.listen(p, HOST, () => srv.close(() => resolve(p)));
    });
  return tryPort(from);
}
