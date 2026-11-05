<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  Monitor,
  Tv,
  Power,
  RotateCcw,
  House,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Volume1,
  Volume2,
  VolumeX,
  Play,
  RefreshCw,
  Keyboard,
  ShieldCheck,
  Wifi,
  WifiOff,
  LoaderCircle,
  AlertCircle,
  Menu,
  Settings2,
  Sun,
  Moon,
  LogOut,
} from 'lucide-vue-next';

type Status = {
  online: boolean;
  booted: boolean;
  model: string;
  size: string;
  serial: string;
  avd: string;
  managed: boolean;
  starting: boolean;
};
const status = ref<Status | null>(null);
const preview = ref('');
const authenticated = ref(false);
const password = ref('');
const loginError = ref('');
const stream = ref<any>(null);
const resources = ref<any>(null);
const message = ref('');
const loading = ref('');
const textInput = ref('');
const autoPreview = ref(true);
const previewInterval = ref(1500);
const previewBusy = ref(false);
const activeTab = ref<'remote' | 'settings'>('remote');
type Theme = 'light' | 'dark';
const theme = ref<Theme>('light');
const themeKey = 'android-emulator-manager-theme';
function setTheme(value: Theme) {
  theme.value = value;
  document.documentElement.classList.toggle('dark', value === 'dark');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', value === 'dark' ? '#09090b' : '#fafafa');
  localStorage.setItem(themeKey, value);
}
function toggleTheme() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark');
}

let statusTimer: ReturnType<typeof setInterval> | undefined;
let imageTimer: ReturnType<typeof setInterval> | undefined;
let imageUrl = '';
const ready = computed(() => !!status.value?.online);
const headers = () => ({});
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/emulator/${path}`, {
    ...options,
    headers: { ...headers(), ...options.headers },
  });
  if (!response.ok) {
    let detail = 'Request failed';
    try {
      detail = (await response.json()).error || detail;
    } catch {}
    throw new Error(detail);
  }
  return response;
}
async function refreshStatus() {
  if (!authenticated.value) return;
  try {
    status.value = await (await request('status')).json();
  } catch (e) {
    message.value = e instanceof Error ? e.message : 'Unable to connect';
    status.value = null;
  }
}
async function screenshot() {
  if (!ready.value || previewBusy.value || !autoPreview.value) return;
  previewBusy.value = true;
  try {
    const response = await request('screenshot');
    const next = URL.createObjectURL(await response.blob());
    const old = imageUrl;
    imageUrl = next;
    preview.value = next;
    if (old) URL.revokeObjectURL(old);
  } catch {
  } finally {
    previewBusy.value = false;
  }
}
async function action(name: string) {
  if (loading.value) return;
  loading.value = name;
  message.value = '';
  try {
    const result = await (await request(name, { method: 'POST' })).json();
    message.value = result.notice || `${name} command sent`;
    await refreshStatus();
  } catch (e) {
    message.value = e instanceof Error ? e.message : 'Command failed';
  } finally {
    loading.value = '';
  }
}
async function key(name: string) {
  if (!ready.value) return;
  try {
    await request('keyevent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: name }),
    });
  } catch (e) {
    message.value = e instanceof Error ? e.message : 'Remote command failed';
  }
}
async function sendText() {
  if (!textInput.value || !ready.value) return;
  try {
    await request('text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textInput.value }),
    });
    textInput.value = '';
    message.value = 'Text sent';
  } catch (e) {
    message.value = e instanceof Error ? e.message : 'Text failed';
  }
}
async function login() {
  loginError.value = '';
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    });
    if (!r.ok) throw Error((await r.json()).error || 'Login failed');
    authenticated.value = true;
    password.value = '';
    await refreshAll();
  } catch (e) {
    loginError.value = e instanceof Error ? e.message : 'Login failed';
  }
}
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  authenticated.value = false;
  status.value = null;
  stream.value = null;
}
async function refreshAll() {
  if (!authenticated.value) return;
  await Promise.all([refreshStatus(), refreshStream(), refreshResources()]);
}
async function refreshStream() {
  try {
    stream.value = await (await fetch('/api/stream/status')).json();
  } catch {
    stream.value = null;
  }
}
async function refreshResources() {
  try {
    resources.value = await (await fetch('/api/system/resources')).json();
  } catch {
    resources.value = null;
  }
}
async function streamAction(name: string) {
  if (loading.value) return;
  loading.value = `stream/${name}`;
  message.value = '';
  try {
    const r = await fetch(`/api/stream/${name}`, { method: 'POST' });
    const result = await r.json();
    if (!r.ok) throw Error(result.error || 'Stream operation failed');
    message.value = result.notice || `Stream ${name} requested`;
    await refreshStream();
  } catch (e) {
    message.value = e instanceof Error ? e.message : 'Stream command failed';
  } finally {
    loading.value = '';
  }
}
function onKeyboard(e: KeyboardEvent) {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.repeat
  )
    return;
  const mapping: Record<string, string> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Enter: 'ok',
    Escape: 'back',
    Backspace: 'back',
  };
  const keyName = mapping[e.key];
  if (keyName) {
    e.preventDefault();
    key(keyName);
  }
}
onMounted(async () => {
  theme.value = document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light';
  try {
    authenticated.value = (
      await (await fetch('/api/auth/session')).json()
    ).authenticated;
  } catch {}
  await refreshAll();
  statusTimer = setInterval(refreshAll, 4000);
  imageTimer = setInterval(screenshot, previewInterval.value);
  window.addEventListener('keydown', onKeyboard);
});
onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer);
  if (imageTimer) clearInterval(imageTimer);
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  window.removeEventListener('keydown', onKeyboard);
});
</script>
<template>
  <div
    class="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
  >
    <div
      v-if="!authenticated"
      class="flex min-h-screen items-center justify-center p-6"
    >
      <form
        class="panel w-full max-w-md space-y-5 p-8 shadow-xl shadow-zinc-900/5 dark:shadow-black/20"
        @submit.prevent="login"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <Tv class="text-emerald-600 dark:text-emerald-400" />
            <h1 class="text-xl font-semibold">Android Manager</h1>
          </div>

          <button
            type="button"
            class="btn btn-icon"
            :aria-label="
              theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
            "
            @click="toggleTheme"
          >
            <Sun v-if="theme === 'dark'" :size="16" />
            <Moon v-else :size="16" />
          </button>
        </div>

        <p class="text-sm text-zinc-600 dark:text-zinc-400">
          Sign in with the administrator password configured in .env.
        </p>

        <input
          v-model="password"
          class="field w-full"
          type="password"
          autocomplete="current-password"
          placeholder="Administrator password"
          required
        />

        <p v-if="loginError" class="text-sm text-rose-700 dark:text-rose-400">
          {{ loginError }}
        </p>

        <button class="btn btn-primary w-full justify-center" type="submit">
          Sign in
        </button>
      </form>
    </div>
    <template v-else>
      <aside
        class="fixed inset-y-0 left-0 z-10 hidden w-72 border-r border-zinc-200 bg-white px-4 py-6 dark:border-white/10 dark:bg-zinc-950 lg:block"
      >
        <div class="flex items-center gap-3 px-3">
          <div
            class="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <Tv :size="23" />
          </div>
          <div>
            <div class="font-semibold tracking-tight">Android Manager</div>
            <div class="text-xs text-zinc-500 dark:text-zinc-400">
              Multicast Studio
            </div>
          </div>
        </div>
        <div
          class="mt-12 px-3 text-[11px] font-semibold tracking-widest text-zinc-500 dark:text-zinc-400 uppercase"
        >
          Workspace
        </div>
        <div
          class="mt-3 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-400/15 dark:bg-emerald-500/10 dark:text-emerald-300"
        >
          <Monitor :size="18" /> Emulator Control
        </div>
        <div
          class="absolute bottom-6 left-4 right-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-zinc-900/60"
        >
          <div
            class="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
          >
            <ShieldCheck :size="15" /> Management interface
          </div>
          <div class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Local ADB · Restricted API
          </div>
        </div>
      </aside>
      <div class="lg:pl-72">
        <header
          class="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-5 py-5 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/90 md:px-9"
        >
          <div class="flex items-center gap-3">
            <Tv
              class="text-emerald-600 dark:text-emerald-400 lg:hidden"
              :size="24"
            /><span class="text-sm text-zinc-600 dark:text-zinc-400"
              >Workspace
              <span class="mx-2 text-zinc-600 dark:text-zinc-400">/</span>
              <span class="text-zinc-100">Emulator Control</span></span
            >
          </div>
          <div
            class="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs dark:border-white/10 dark:bg-zinc-900"
          >
            <span
              class="size-2 rounded-full"
              :class="ready ? 'bg-emerald-400' : 'bg-zinc-500'"
            ></span
            >{{ ready ? 'Device connected' : 'Device offline' }}
          </div>
          <button
            class="btn btn-icon ml-auto"
            :title="theme === 'dark' ? 'Light mode' : 'Dark mode'"
            :aria-label="
              theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
            "
            @click="toggleTheme"
          >
            <Sun v-if="theme === 'dark'" :size="16" /><Moon v-else :size="16" />
          </button>
          <button class="btn ml-3 gap-2 text-xs" @click="logout">
            <LogOut :size="15" /> Sign out
          </button>
        </header>
        <main class="mx-auto max-w-7xl space-y-7 px-5 py-8 md:px-9">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div
                class="mb-2 text-xs font-semibold tracking-widest text-emerald-600 uppercase dark:text-emerald-400"
              >
                Android TV / Device management
              </div>
              <h1 class="text-3xl font-semibold tracking-tight">
                Emulator Control
              </h1>
              <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Manage and operate your Android TV emulator from the browser.
              </p>
            </div>
            <button class="btn gap-2 px-4 text-sm" @click="refreshStatus">
              <RefreshCw :size="16" /> Refresh status
            </button>
          </div>
          <div
            v-if="message"
            class="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200"
          >
            <AlertCircle :size="16" /> {{ message }}
            <button
              class="ml-auto text-zinc-600 dark:text-zinc-400"
              @click="message = ''"
            >
              ×
            </button>
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="panel p-5">
              <div
                class="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <Wifi :size="16" /> Connection
              </div>
              <div class="mt-3 text-xl font-semibold">
                {{ ready ? 'Online' : 'Offline' }}
              </div>
              <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {{ status?.serial || 'Checking device...' }}
              </div>
            </div>
            <div class="panel p-5">
              <div
                class="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <Tv :size="16" /> Virtual device
              </div>
              <div class="mt-3 truncate text-xl font-semibold">
                {{ status?.avd || 'MulticastAndroidTV' }}
              </div>
              <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {{ status?.model || 'Android TV Emulator' }}
              </div>
            </div>
            <div class="panel p-5">
              <div
                class="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <Monitor :size="16" /> Android status
              </div>
              <div class="mt-3 text-xl font-semibold">
                {{
                  status?.booted ? 'Ready' : ready ? 'Booting' : 'Not running'
                }}
              </div>
              <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {{ status?.size || '1280 × 720 configured' }}
              </div>
            </div>
          </div>
          <div
            class="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]"
          >
            <section class="panel overflow-hidden">
              <div
                class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-white/10 px-5 py-4"
              >
                <div>
                  <h2 class="font-semibold">Live screen</h2>
                  <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Screenshot preview · lightweight mode
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="pill">{{
                    autoPreview ? 'Auto refresh' : 'Paused'
                  }}</span
                  ><button
                    class="btn !min-h-9 px-3 text-xs"
                    @click="autoPreview = !autoPreview"
                  >
                    {{ autoPreview ? 'Pause' : 'Resume' }}
                  </button>
                </div>
              </div>
              <div class="p-4 md:p-6">
                <div
                  class="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-zinc-200 dark:border-white/10 bg-black"
                >
                  <img
                    v-if="preview && ready"
                    :src="preview"
                    alt="Android TV screen"
                    class="h-full w-full object-contain"
                  />
                  <div
                    v-else
                    class="flex flex-col items-center gap-3 text-zinc-500 dark:text-zinc-400"
                  >
                    <component
                      :is="ready ? Monitor : WifiOff"
                      :size="42"
                      :stroke-width="1.3"
                    /><span class="text-sm">{{
                      ready
                        ? 'Waiting for first screenshot'
                        : 'Emulator is offline'
                    }}</span>
                  </div>
                  <div
                    class="absolute bottom-3 left-3 rounded-md bg-black/70 px-2 py-1 text-[11px] text-zinc-700 dark:text-zinc-300"
                  >
                    ANDROID TV · {{ status?.serial || 'emulator-5554' }}
                  </div>
                </div>
                <div
                  class="mt-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div class="text-xs text-zinc-500 dark:text-zinc-400">
                    Preview uses ADB screenshots. Streaming video remains
                    independent.
                  </div>
                  <button
                    class="btn !min-h-9 gap-2 px-3 text-xs"
                    :disabled="!ready"
                    @click="screenshot"
                  >
                    <RefreshCw :size="14" /> Capture now
                  </button>
                </div>
              </div>
            </section>
            <section class="panel">
              <div class="flex border-b border-zinc-200 dark:border-white/10">
                <button
                  class="flex flex-1 items-center justify-center gap-2 py-4 text-sm"
                  :class="
                    activeTab === 'remote'
                      ? 'border-b-2 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                      : 'text-zinc-500 dark:text-zinc-400'
                  "
                  @click="activeTab = 'remote'"
                >
                  <Menu :size="16" /> Remote</button
                ><button
                  class="flex flex-1 items-center justify-center gap-2 py-4 text-sm"
                  :class="
                    activeTab === 'settings'
                      ? 'border-b-2 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                      : 'text-zinc-500 dark:text-zinc-400'
                  "
                  @click="activeTab = 'settings'"
                >
                  <Settings2 :size="16" /> Settings
                </button>
              </div>
              <div v-if="activeTab === 'remote'" class="space-y-6 p-5">
                <div class="flex justify-center gap-3">
                  <button
                    class="btn size-12"
                    :disabled="!ready"
                    title="Home"
                    @click="key('home')"
                  >
                    <House :size="19" /></button
                  ><button
                    class="btn size-12"
                    :disabled="!ready"
                    title="Back"
                    @click="key('back')"
                  >
                    <ArrowLeft :size="19" /></button
                  ><button
                    class="btn size-12"
                    :disabled="!ready"
                    title="Menu"
                    @click="key('menu')"
                  >
                    <Menu :size="19" />
                  </button>
                </div>
                <div class="mx-auto grid max-w-[214px] grid-cols-3 gap-2">
                  <div></div>
                  <button
                    class="btn aspect-square"
                    :disabled="!ready"
                    aria-label="Up"
                    @click="key('up')"
                  >
                    <ChevronUp :size="27" />
                  </button>
                  <div></div>
                  <button
                    class="btn aspect-square"
                    :disabled="!ready"
                    aria-label="Left"
                    @click="key('left')"
                  >
                    <ChevronLeft :size="27" /></button
                  ><button
                    class="btn aspect-square !border-emerald-500/40 !bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    :disabled="!ready"
                    aria-label="Select"
                    @click="key('ok')"
                  >
                    <CircleDot :size="25" /></button
                  ><button
                    class="btn aspect-square"
                    :disabled="!ready"
                    aria-label="Right"
                    @click="key('right')"
                  >
                    <ChevronRight :size="27" />
                  </button>
                  <div></div>
                  <button
                    class="btn aspect-square"
                    :disabled="!ready"
                    aria-label="Down"
                    @click="key('down')"
                  >
                    <ChevronDown :size="27" />
                  </button>
                </div>
                <div
                  class="flex justify-center gap-3 border-t border-zinc-200 dark:border-white/10 pt-5"
                >
                  <button
                    class="btn size-12"
                    :disabled="!ready"
                    title="Volume down"
                    @click="key('volumeDown')"
                  >
                    <Volume1 :size="19" /></button
                  ><button
                    class="btn size-12"
                    :disabled="!ready"
                    title="Play / pause"
                    @click="key('playPause')"
                  >
                    <Play :size="19" /></button
                  ><button
                    class="btn size-12"
                    :disabled="!ready"
                    title="Volume up"
                    @click="key('volumeUp')"
                  >
                    <Volume2 :size="19" /></button
                  ><button
                    class="btn size-12"
                    :disabled="!ready"
                    title="Mute"
                    @click="key('mute')"
                  >
                    <VolumeX :size="19" />
                  </button>
                </div>
                <form class="flex gap-2" @submit.prevent="sendText">
                  <input
                    v-model="textInput"
                    class="field min-w-0 flex-1 text-sm"
                    maxlength="160"
                    placeholder="Send text to Android"
                    aria-label="Text to send"
                  /><button
                    class="btn px-4"
                    :disabled="!ready || !textInput"
                    type="submit"
                  >
                    <Keyboard :size="18" />
                  </button>
                </form>
                <p class="text-center text-xs text-zinc-500 dark:text-zinc-400">
                  Keyboard arrows, Enter, Esc and Backspace also work.
                </p>
              </div>
              <div v-else class="space-y-4 p-5">
                <p class="text-sm text-zinc-700 dark:text-zinc-300">
                  Administrator session
                </p>
                <p class="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Authenticated using ADMIN_PASSWORD from .env. Session expires
                  after 12 hours. Restrict access to the management network.
                </p>
                <button class="btn w-full text-sm" @click="logout">
                  Sign out
                </button>
              </div>
            </section>
          </div>
          <section class="panel p-5 md:p-6 space-y-5">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 class="font-semibold">HTTP live stream</h2>
                <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  scrcpy → Matroska FIFO → FFmpeg H.264 passthrough + AAC →
                  MPEG-TS
                </p>
              </div>
              <span class="pill">{{
                stream?.running
                  ? 'Streaming'
                  : stream?.starting
                    ? 'Starting'
                    : 'Stopped'
              }}</span>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button
                class="btn px-4 text-sm"
                :disabled="!ready || !!loading || stream?.running"
                @click="streamAction('start')"
              >
                Start stream</button
              ><button
                class="btn px-4 text-sm"
                :disabled="!!loading || !stream?.running"
                @click="streamAction('stop')"
              >
                Stop stream</button
              ><button
                class="btn px-4 text-sm"
                :disabled="!!loading || !stream?.running"
                @click="streamAction('restart')"
              >
                Stop for restart</button
              ><a
                v-if="stream?.url"
                class="text-sm text-emerald-700 dark:text-emerald-300 underline break-all"
                :href="stream.url"
                target="_blank"
                rel="noreferrer"
                >{{ stream.url }}</a
              >
            </div>
            <div class="grid gap-3 sm:grid-cols-3">
              <div class="text-sm text-zinc-600 dark:text-zinc-400">
                FFmpeg:
                <span
                  :class="
                    stream?.tools?.ffmpeg ? 'text-emerald-400' : 'text-rose-400'
                  "
                  >{{ stream?.tools?.ffmpeg ? 'Available' : 'Missing' }}</span
                >
              </div>
              <div class="text-sm text-zinc-600 dark:text-zinc-400">
                scrcpy:
                <span
                  :class="
                    stream?.tools?.scrcpy ? 'text-emerald-400' : 'text-rose-400'
                  "
                  >{{ stream?.tools?.scrcpy ? 'Available' : 'Missing' }}</span
                >
              </div>
              <div class="text-sm text-zinc-600 dark:text-zinc-400">
                FIFO: {{ stream?.pipeReady ? 'Ready' : 'Not created yet' }}
              </div>
            </div>
            <p
              v-if="stream?.error"
              class="text-sm text-rose-700 dark:text-rose-400"
            >
              {{ stream.error }}
            </p>
            <details class="text-xs text-zinc-600 dark:text-zinc-400">
              <summary class="cursor-pointer">Process output</summary>
              <pre
                class="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3"
                >{{ stream?.log || 'No output yet' }}</pre>
            </details>
            <p class="text-xs text-zinc-500 dark:text-zinc-400">
              HTTP listener supports one client at a time. Open the URL in VLC;
              browser playback of MPEG-TS is not guaranteed.
            </p>
          </section>
          <section class="panel p-5 md:p-6">
            <h2 class="font-semibold">Host resources</h2>
            <div class="mt-4 grid gap-4 sm:grid-cols-4">
              <div>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  CPU utilization
                </p>
                <p class="mt-1 text-xl font-semibold">
                  {{ resources?.cpuPercent ?? '—' }}%
                </p>
              </div>
              <div>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">RAM used</p>
                <p class="mt-1 text-xl font-semibold">
                  {{
                    resources
                      ? (resources.memoryUsed / 1073741824).toFixed(1) + ' GB'
                      : '—'
                  }}
                </p>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  {{
                    resources
                      ? (resources.memoryTotal / 1073741824).toFixed(1) +
                        ' GB total'
                      : ''
                  }}
                </p>
              </div>
              <div>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  CPU cores
                </p>
                <p class="mt-1 text-xl font-semibold">
                  {{ resources?.cores ?? '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  Load average
                </p>
                <p class="mt-1 text-xl font-semibold">
                  {{ resources?.load?.[0]?.toFixed(2) ?? '—' }}
                </p>
              </div>
            </div>
          </section>
          <section class="panel p-5 md:p-6">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 class="font-semibold">Emulator lifecycle</h2>
                <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Start, reboot or gracefully stop the Android TV instance.
                </p>
              </div>
              <div class="flex flex-wrap gap-3">
                <button
                  class="btn gap-2 px-4 text-sm"
                  :disabled="ready || !!loading"
                  @click="action('start')"
                >
                  <Power
                    :size="16"
                    class="text-emerald-600 dark:text-emerald-400"
                  />
                  Start emulator</button
                ><button
                  class="btn gap-2 px-4 text-sm"
                  :disabled="!ready || !!loading"
                  @click="action('restart')"
                >
                  <RotateCcw :size="16" /> Reboot Android</button
                ><button
                  class="btn gap-2 px-4 text-sm text-rose-300"
                  :disabled="!ready || !!loading"
                  @click="action('stop')"
                >
                  <Power :size="16" /> Stop emulator
                </button>
              </div>
            </div>
          </section>
          <footer class="pb-6 text-xs text-zinc-600 dark:text-zinc-400">
            Android Emulator Manager · Multicast Studio integration foundation ·
            v0.1.0
          </footer>
        </main>
      </div>
    </template>
  </div>
</template>
