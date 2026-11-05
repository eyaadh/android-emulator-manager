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
// A disconnected HTTP client ends FFmpeg's single-client listener. Keep the
// requested stream running by rebuilding BOTH sides of the FIFO after exit.
let streamDesired = false;
let streamGeneration = 0;
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let restartAttempts = 0;
let streamStopping: Promise<void> = Promise.resolve();
const RESTART_BASE_MS = 1500;
const RESTART_MAX_MS = 15000;
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
    return statSync(PIPE).isFIFO();
  } catch {
    return false;
  }
};
const isAlive = (child?: ChildProcess) =>
  !!child && child.exitCode === null && child.signalCode === null;
const waitForExit = (child: ChildProcess): Promise<void> =>
  new Promise((done) => {
    if (!isAlive(child)) return done();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      done();
    };
    const timeout = setTimeout(() => {
      if (child.pid && isAlive(child)) child.kill('SIGKILL');
      finish();
    }, 4000);
    child.once('close', finish);
    child.once('exit', finish);
    if (child.pid) child.kill('SIGTERM');
  });
const clearRestart = () => {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = undefined;
};
const stopChildren = async () => {
  // Serialize cleanup so a replacement never races an old HTTP listener.
  streamStopping = streamStopping.then(async () => {
    const children = [scrcpy, ffmpeg].filter(
      (child): child is ChildProcess => !!child
    );
    scrcpy = undefined;
    ffmpeg = undefined;
    await Promise.all(children.map(waitForExit));
  });
  await streamStopping;
};
const stopStream = async () => {
  streamDesired = false;
  streamGeneration++;
  clearRestart();
  await stopChildren();
  streamBusy = false;
};
const scheduleRecovery = (generation: number, reason: string) => {
  if (!streamDesired || generation !== streamGeneration || restartTimer) return;
  streamError = reason;
  const delay = Math.min(
    RESTART_BASE_MS * 2 ** Math.min(restartAttempts++, 4),
    RESTART_MAX_MS
  );
  appendLog(Buffer.from(`\n[manager] ${reason}; restarting in ${delay}ms\n`));
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    if (streamDesired && generation === streamGeneration)
      void launchStream(generation);
  }, delay);
};
async function launchStream(generation: number) {
  if (!streamDesired || generation !== streamGeneration || streamBusy) return;
  streamBusy = true;
  try {
    await stopChildren();
    if (!streamDesired || generation !== streamGeneration) return;
    if (!(await connected())) throw Error('Emulator is offline');
    if (
      !(await toolCheck(FFMPEG, ['-version'])) ||
      !(await toolCheck(SCRCPY, ['--version']))
    )
      throw Error('Install FFmpeg and scrcpy on Ubuntu first');
    // Never replace an existing regular file or symlink with a FIFO.
    if (existsSync(PIPE) && !(await pipeCheck()))
      throw Error(`STREAM_PIPE exists but is not a FIFO: ${PIPE}`);
    if (!existsSync(PIPE))
      await run('mkfifo', ['-m', '600', PIPE], { timeout: 5000 });
    if (!streamDesired || generation !== streamGeneration) return;

    const encoder = spawn(
      FFMPEG,
      [
        '-hide_banner',
        '-loglevel',
        'warning',
        '-fflags',
        '+genpts+discardcorrupt',
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
        '-af',
        'aresample=async=1000:first_pts=0',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-f',
        'mpegts',
        '-flush_packets',
        '1',
        '-listen',
        '1',
        `http://0.0.0.0:${STREAM_PORT}/live.ts`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    ffmpeg = encoder;
    encoder.stderr?.on('data', appendLog);
    const onFailure = (name: string, child: ChildProcess, reason: string) => {
      if (!streamDesired || generation !== streamGeneration) return;
      if (child !== ffmpeg && child !== scrcpy) return;
      // A failure in either process requires restarting the whole pipeline.
      scheduleRecovery(generation, `${name}: ${reason}`);
      void stopChildren();
    };
    encoder.on('error', (e) => onFailure('FFmpeg', encoder, e.message));
    encoder.on('exit', (code, signal) =>
      onFailure('FFmpeg', encoder, `exited (${code ?? signal})`)
    );

    const recorder = spawn(
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
        '12M',
        '--audio-codec=opus',
        '--record',
        PIPE,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    scrcpy = recorder;
    recorder.stderr?.on('data', appendLog);
    recorder.on('error', (e) => onFailure('scrcpy', recorder, e.message));
    recorder.on('exit', (code, signal) =>
      onFailure('scrcpy', recorder, `exited (${code ?? signal})`)
    );
    streamError = '';
    // A stable run resets exponential backoff, rather than penalizing normal
    // viewer disconnects that occur minutes or hours later.
    setTimeout(() => {
      if (generation === streamGeneration && isAlive(ffmpeg) && isAlive(scrcpy))
        restartAttempts = 0;
    }, 30000).unref();
  } catch (e) {
    scheduleRecovery(
      generation,
      e instanceof Error ? e.message : 'Stream start failed'
    );
  } finally {
    streamBusy = false;
  }
}
app.get('/api/stream/status', async (c) =>
  c.json({
    running: isAlive(ffmpeg) && isAlive(scrcpy),
    starting: streamBusy || !!restartTimer,
    ffmpeg: isAlive(ffmpeg),
    scrcpy: isAlive(scrcpy),
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
app.post('/api/stream/start', async (c) => {
  if (streamDesired || streamBusy)
    return c.json({ error: 'Stream already running or starting' }, 409);
  if (!(await connected()))
    return c.json({ error: 'Start the emulator first' }, 409);
  streamDesired = true;
  streamError = '';
  ffmpegLog = '';
  restartAttempts = 0;
  const generation = ++streamGeneration;
  void launchStream(generation);
  return c.json({
    ok: true,
    notice:
      'Stream starting; disconnected viewers will be handled automatically',
    url: STREAM_URL,
  });
});
app.post('/api/stream/stop', async (c) => {
  await stopStream();
  return c.json({ ok: true });
});
app.post('/api/stream/restart', async (c) => {
  await stopStream();
  if (!(await connected()))
    return c.json({ error: 'Start the emulator first' }, 409);
  streamDesired = true;
  streamError = '';
  restartAttempts = 0;
  const generation = ++streamGeneration;
  void launchStream(generation);
  return c.json({ ok: true, notice: 'Stream restarting', url: STREAM_URL });
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
