import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { cpus, totalmem, freemem, loadavg, uptime } from 'node:os';
import { createHmac, randomBytes } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const run = promisify(execFile);
const ADB = process.env.ADB_PATH || 'adb';
const EMULATOR =
  process.env.EMULATOR_PATH ||
  resolve(
    process.env.HOME || '/home/vakadmin',
    'android-sdk/emulator/emulator'
  );
const SERIAL = process.env.ANDROID_SERIAL || 'emulator-5554';
const AVD = process.env.AVD_NAME || 'MulticastAndroidTV';
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '127.0.0.1';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || '';
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';
// Allow the configured Vite origin only in development. Keep production same-origin.
const DEV_ORIGIN = process.env.DEV_ORIGIN || `http://${HOST}:5173`;
const originAllowed = (
  origin: string | undefined,
  host: string | undefined
) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (
      url.host === host &&
      (url.protocol === 'http:' || url.protocol === 'https:')
    )
      return true;
    return process.env.NODE_ENV !== 'production' && url.origin === DEV_ORIGIN;
  } catch {
    return false;
  }
};
if (!PASSWORD || PASSWORD.length < 6 || SECRET.length < 32)
  throw Error(
    'Configure ADMIN_PASSWORD (6+ characters) and SESSION_SECRET (32+ characters)'
  );
const app = new Hono();
let managed: ChildProcess | undefined;
let busy = false;
const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
const sign = (value: string) =>
  createHmac('sha256', SECRET).update(value).digest('hex');
const sessionValid = (cookie?: string) => {
  if (!cookie) return false;
  const [expiry, nonce, mac] = cookie.split('.');
  if (
    !expiry ||
    !nonce ||
    !mac ||
    !/^\d+$/.test(expiry) ||
    Number(expiry) < Date.now()
  )
    return false;
  return safeEqual(mac, sign(`${expiry}.${nonce}`));
};
const cookieOptions = {
  httpOnly: true,
  sameSite: 'Strict' as const,
  secure: SECURE_COOKIE,
  path: '/',
};
let failures = new Map<string, { count: number; until: number }>();
app.post('/api/auth/login', async (c) => {
  const ip = c.req.header('host') || 'local';
  const state = failures.get(ip);
  if (state && state.count >= 5 && state.until > Date.now())
    return c.json({ error: 'Too many attempts; retry in 15 minutes' }, 429);
  if (!originAllowed(c.req.header('origin'), c.req.header('host')))
    return c.json({ error: 'Origin mismatch' }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  if (
    typeof body.password !== 'string' ||
    !safeEqual(body.password, PASSWORD)
  ) {
    failures.set(ip, {
      count: (state?.until && state.until > Date.now() ? state.count : 0) + 1,
      until: Date.now() + 900000,
    });
    return c.json({ error: 'Invalid password' }, 401);
  }
  failures.delete(ip);
  const expiry = String(Date.now() + 12 * 3600000),
    nonce = randomBytes(16).toString('hex');
  setCookie(
    c,
    'android_session',
    `${expiry}.${nonce}.${sign(`${expiry}.${nonce}`)}`,
    { ...cookieOptions, maxAge: 43200 }
  );
  return c.json({ ok: true });
});
app.get('/api/auth/session', (c) =>
  c.json({ authenticated: sessionValid(getCookie(c, 'android_session')) })
);
app.post('/api/auth/logout', (c) => {
  deleteCookie(c, 'android_session', cookieOptions);
  return c.json({ ok: true });
});
app.use('/api/*', async (c, next) => {
  if (!sessionValid(getCookie(c, 'android_session')))
    return c.json({ error: 'Unauthorized' }, 401);
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    if (!originAllowed(c.req.header('origin'), c.req.header('host')))
      return c.json({ error: 'Origin mismatch' }, 403);
  }
  await next();
});
const adb = async (...args: string[]) =>
  (
    await run(ADB, ['-s', SERIAL, ...args], {
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout.trim();
async function connected() {
  try {
    return (await adb('get-state')) === 'device';
  } catch {
    return false;
  }
}
async function status() {
  const online = await connected();
  let booted = false,
    model = '',
    size = '';
  if (online) {
    try {
      booted = (await adb('shell', 'getprop', 'sys.boot_completed')) === '1';
      model = await adb('shell', 'getprop', 'ro.product.model');
      size = await adb('shell', 'wm', 'size');
    } catch {}
  }
  return {
    online,
    booted,
    model,
    size,
    serial: SERIAL,
    avd: AVD,
    managed: !!managed,
    starting: busy,
  };
}
app.get('/api/emulator/status', async (c) => c.json(await status()));
const keys: Record<string, number> = {
  home: 3,
  back: 4,
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  ok: 23,
  volumeUp: 24,
  volumeDown: 25,
  mute: 164,
  playPause: 85,
  power: 26,
  menu: 82,
};
app.post('/api/emulator/keyevent', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { key?: string };
  if (!body.key || !(body.key in keys))
    return c.json({ error: 'Unsupported key' }, 400);
  if (!(await connected())) return c.json({ error: 'Emulator offline' }, 409);
  try {
    await adb('shell', 'input', 'keyevent', String(keys[body.key]));
    return c.json({ ok: true });
  } catch {
    return c.json({ error: 'ADB command failed' }, 500);
  }
});
app.get('/api/emulator/screenshot', async (c) => {
  if (!(await connected())) return c.json({ error: 'Emulator offline' }, 409);
  try {
    const { stdout } = await run(
      ADB,
      ['-s', SERIAL, 'exec-out', 'screencap', '-p'],
      { encoding: 'buffer', timeout: 12000, maxBuffer: 12 * 1024 * 1024 }
    );
    c.header('Cache-Control', 'no-store');
    c.header('Content-Type', 'image/png');
    return c.body(new Uint8Array(stdout));
  } catch {
    return c.json({ error: 'Screenshot failed' }, 500);
  }
});
app.post('/api/emulator/start', async (c) => {
  if (busy || (await connected()))
    return c.json({ error: 'Emulator is already running or starting' }, 409);
  busy = true;
  try {
    managed = spawn(
      EMULATOR,
      [
        '-avd',
        AVD,
        '-no-window',
        '-no-boot-anim',
        '-no-snapshot',
        '-gpu',
        'software',
        '-accel',
        'on',
        '-memory',
        '4096',
        '-cores',
        '6',
        '-no-metrics',
      ],
      { stdio: 'ignore', env: process.env }
    );
    managed.on('error', (e) => {
      console.error('Emulator spawn failed:', e);
      managed = undefined;
      busy = false;
    });
    managed.on('exit', () => {
      managed = undefined;
      busy = false;
    });
    busy = false;
    return c.json({
      ok: true,
      notice: 'Emulator starting; allow time for Android to boot',
    });
  } catch {
    busy = false;
    return c.json({ error: 'Unable to start emulator' }, 500);
  }
});
app.post('/api/emulator/stop', async (c) => {
  if (!(await connected())) return c.json({ error: 'Emulator offline' }, 409);
  try {
    await stopStream();
    await adb('emu', 'kill');
    return c.json({ ok: true });
  } catch {
    return c.json({ error: 'Unable to stop emulator' }, 500);
  }
});
app.post('/api/emulator/restart', async (c) => {
  if (!(await connected())) return c.json({ error: 'Emulator offline' }, 409);
  try {
    await adb('reboot');
    return c.json({ ok: true, notice: 'Android is rebooting' });
  } catch {
    return c.json({ error: 'Unable to reboot Android' }, 500);
  }
});
app.post('/api/emulator/text', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  if (
    typeof body.text !== 'string' ||
    body.text.length > 160 ||
    !body.text ||
    /[^\x20-\x7E]/.test(body.text)
  )
    return c.json({ error: 'Text must be 1–160 ASCII characters' }, 400);
  if (!(await connected())) return c.json({ error: 'Emulator offline' }, 409);
  try {
    await adb('shell', 'input', 'text', body.text.replace(/ /g, '%s'));
    return c.json({ ok: true });
  } catch {
    return c.json({ error: 'Text entry failed' }, 500);
  }
});
// FIFO-based scrcpy -> FFmpeg pipeline. Only the manager's child processes are stopped.
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const SCRCPY = process.env.SCRCPY_PATH || 'scrcpy';
const PIPE =
  process.env.STREAM_PIPE ||
  resolve(process.env.HOME || '/home/vakadmin', 'android-live.mkv');
const STREAM_PORT = Number(process.env.STREAM_PORT || 8080);
const STREAM_URL = `http://${HOST}:${STREAM_PORT}/live.ts`;
let ffmpeg: ChildProcess | undefined;
let scrcpy: ChildProcess | undefined;
let streamBusy = false;
let streamError = '';
let ffmpegLog = '';
const appendLog = (chunk: Buffer) => {
  ffmpegLog = (ffmpegLog + chunk.toString()).slice(-12000);
};
const toolCheck = async (binary: string, args: string[]) => {
  try {
    await run(binary, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};
const pipeCheck = async () => {
  try {
    const st = statSync(PIPE);
    return st.isFIFO();
  } catch {
    return false;
  }
};
app.get('/api/stream/status', async (c) =>
  c.json({
    running:
      !!ffmpeg &&
      ffmpeg.exitCode === null &&
      !!scrcpy &&
      scrcpy.exitCode === null,
    starting: streamBusy,
    ffmpeg: !!ffmpeg && ffmpeg.exitCode === null,
    scrcpy: !!scrcpy && scrcpy.exitCode === null,
    url: STREAM_URL,
    error: streamError,
    log: ffmpegLog.slice(-3000),
    tools: {
      ffmpeg: await toolCheck(FFMPEG, ['-version']),
      scrcpy: await toolCheck(SCRCPY, ['--version']),
    },
    pipeReady: await pipeCheck(),
  })
);
const stopStream = async () => {
  for (const child of [scrcpy, ffmpeg])
    if (child && child.exitCode === null) child.kill('SIGTERM');
  scrcpy = undefined;
  ffmpeg = undefined;
};
app.post('/api/stream/start', async (c) => {
  if (streamBusy || ffmpeg || scrcpy)
    return c.json({ error: 'Stream already running or starting' }, 409);
  if (!(await connected()))
    return c.json({ error: 'Start the emulator first' }, 409);
  streamBusy = true;
  streamError = '';
  ffmpegLog = '';
  try {
    if (
      !(await toolCheck(FFMPEG, ['-version'])) ||
      !(await toolCheck(SCRCPY, ['--version']))
    )
      throw Error('Install FFmpeg and scrcpy on Ubuntu first');
    // Never replace a regular file or symlink with a FIFO.
    if (existsSync(PIPE) && !(await pipeCheck()))
      throw Error(`STREAM_PIPE exists but is not a FIFO: ${PIPE}`);
    if (!existsSync(PIPE))
      await run('mkfifo', ['-m', '600', PIPE], { timeout: 5000 });
    ffmpeg = spawn(
      FFMPEG,
      [
        '-hide_banner',
        '-loglevel',
        'warning',
        '-f',
        'matroska',
        '-i',
        PIPE,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-f',
        'mpegts',
        '-listen',
        '1',
        `http://0.0.0.0:${STREAM_PORT}/live.ts`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    ffmpeg.stderr?.on('data', appendLog);
    ffmpeg.on('error', (e) => {
      streamError = `FFmpeg: ${e.message}`;
      void stopStream();
    });
    ffmpeg.on('exit', (code) => {
      if (ffmpeg) {
        streamError ||= `FFmpeg exited (${code})`;
        void stopStream();
      }
    });
    scrcpy = spawn(
      SCRCPY,
      [
        '--serial',
        SERIAL,
        '--no-playback',
        '--max-size',
        '1280',
        '--max-fps',
        '30',
        '--video-bit-rate',
        '8M',
        '--audio-codec=opus',
        '--record',
        PIPE,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    scrcpy.stderr?.on('data', (chunk) => {
      ffmpegLog = (ffmpegLog + chunk.toString()).slice(-12000);
    });
    scrcpy.on('error', (e) => {
      streamError = `scrcpy: ${e.message}`;
      void stopStream();
    });
    scrcpy.on('exit', (code) => {
      if (scrcpy) {
        streamError ||= `scrcpy exited (${code})`;
        void stopStream();
      }
    });
    return c.json({
      ok: true,
      notice: 'Stream processes launched; connect VLC to the stream URL',
      url: STREAM_URL,
    });
  } catch (e) {
    await stopStream();
    return c.json(
      { error: e instanceof Error ? e.message : 'Stream start failed' },
      500
    );
  } finally {
    streamBusy = false;
  }
});
app.post('/api/stream/stop', async (c) => {
  await stopStream();
  return c.json({ ok: true });
});
app.post('/api/stream/restart', async (c) => {
  await stopStream();
  return c.json({
    ok: true,
    notice: 'Stopped. Click Start stream to relaunch.',
  });
});
let previousCpu = cpus().map((cpu) => ({ ...cpu.times }));
app.get('/api/system/resources', (c) => {
  const current = cpus().map((cpu) => cpu.times);
  let idle = 0,
    total = 0;
  current.forEach((times, i) => {
    const old = previousCpu[i];
    const nowTotal = Object.values(times).reduce((a, b) => a + b, 0);
    const oldTotal = Object.values(old || times).reduce((a, b) => a + b, 0);
    total += nowTotal - oldTotal;
    idle += times.idle - (old?.idle ?? times.idle);
  });
  previousCpu = current.map((t) => ({ ...t }));
  return c.json({
    cpuPercent: total > 0 ? Math.round((1 - idle / total) * 100) : 0,
    memoryTotal: totalmem(),
    memoryUsed: totalmem() - freemem(),
    load: loadavg(),
    uptime: uptime(),
    cores: current.length,
  });
});
app.get('/api/healthz', (c) => c.json({ ok: true }));
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', (c) =>
    c.html(readFileSync(resolve(dist, 'index.html'), 'utf8'))
  );
}
serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () =>
  console.log(`Emulator Manager: http://${HOST}:${PORT}`)
);
