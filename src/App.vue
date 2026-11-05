<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Monitor, Tv, Power, RotateCcw, House, ArrowLeft, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, CircleDot, Volume1, Volume2, VolumeX, PlayPause, RefreshCw, Keyboard, ShieldCheck, Wifi, WifiOff, LoaderCircle, AlertCircle, Menu, Settings2 } from 'lucide-vue-next'

type Status={online:boolean;booted:boolean;model:string;size:string;serial:string;avd:string;managed:boolean;starting:boolean}
const status=ref<Status|null>(null)
const preview=ref('')
const token=ref(sessionStorage.getItem('manager-token')||'')
const tokenInput=ref(token.value)
const message=ref('')
const loading=ref('')
const textInput=ref('')
const autoPreview=ref(true)
const previewInterval=ref(1500)
const previewBusy=ref(false)
const activeTab=ref<'remote'|'settings'>('remote')
let statusTimer:ReturnType<typeof setInterval>|undefined
let imageTimer:ReturnType<typeof setInterval>|undefined
let imageUrl=''
const ready=computed(()=>!!status.value?.online)
const headers=()=>token.value?{Authorization:`Bearer ${token.value}`}:{ }
async function request(path:string,options:RequestInit={}){
  const response=await fetch(`/api/emulator/${path}`,{...options,headers:{...headers(),...options.headers}})
  if(!response.ok){let detail='Request failed';try{detail=(await response.json()).error||detail}catch{};throw new Error(detail)}
  return response
}
async function refreshStatus(){try{status.value=await(await request('status')).json()}catch(e){message.value=e instanceof Error?e.message:'Unable to connect';status.value=null}}
async function screenshot(){
  if(!ready.value||previewBusy.value||!autoPreview.value)return
  previewBusy.value=true
  try{const response=await request('screenshot');const next=URL.createObjectURL(await response.blob());const old=imageUrl;imageUrl=next;preview.value=next;if(old)URL.revokeObjectURL(old)}catch{}finally{previewBusy.value=false}
}
async function action(name:string){if(loading.value)return;loading.value=name;message.value='';try{const result=await(await request(name,{method:'POST'})).json();message.value=result.notice||`${name} command sent`;await refreshStatus()}catch(e){message.value=e instanceof Error?e.message:'Command failed'}finally{loading.value=''}}
async function key(name:string){if(!ready.value)return;try{await request('keyevent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:name})})}catch(e){message.value=e instanceof Error?e.message:'Remote command failed'}}
async function sendText(){if(!textInput.value||!ready.value)return;try{await request('text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:textInput.value})});textInput.value='';message.value='Text sent'}catch(e){message.value=e instanceof Error?e.message:'Text failed'}}
function saveToken(){token.value=tokenInput.value.trim();sessionStorage.setItem('manager-token',token.value);message.value='API token updated';refreshStatus()}
function onKeyboard(e:KeyboardEvent){if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.repeat)return;const mapping:Record<string,string>={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Enter:'ok',Escape:'back',Backspace:'back'};const keyName=mapping[e.key];if(keyName){e.preventDefault();key(keyName)}}
onMounted(()=>{refreshStatus();statusTimer=setInterval(refreshStatus,4000);imageTimer=setInterval(screenshot,previewInterval.value);window.addEventListener('keydown',onKeyboard)})
onUnmounted(()=>{if(statusTimer)clearInterval(statusTimer);if(imageTimer)clearInterval(imageTimer);if(imageUrl)URL.revokeObjectURL(imageUrl);window.removeEventListener('keydown',onKeyboard)})
</script>
<template>
<div class="min-h-screen bg-[#09090b] text-zinc-100">
  <aside class="fixed inset-y-0 left-0 z-10 hidden w-64 border-r border-zinc-800 bg-[#101013] px-4 py-6 lg:block">
    <div class="flex items-center gap-3 px-3"><div class="flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400"><Tv :size="23"/></div><div><div class="font-semibold tracking-tight">Android Manager</div><div class="text-xs text-zinc-500">Multicast Studio</div></div></div>
    <div class="mt-12 px-3 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">Workspace</div>
    <div class="mt-3 flex items-center gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-3 py-3 text-sm font-medium text-indigo-300"><Monitor :size="18"/> Emulator Control</div>
    <div class="absolute bottom-6 left-4 right-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4"><div class="flex items-center gap-2 text-xs text-zinc-400"><ShieldCheck :size="15"/> Management interface</div><div class="mt-2 text-xs text-zinc-500">Local ADB · Restricted API</div></div>
  </aside>
  <div class="lg:pl-64">
    <header class="flex items-center justify-between border-b border-zinc-800 px-5 py-5 md:px-9"><div class="flex items-center gap-3"><Tv class="text-indigo-400 lg:hidden" :size="24"/><span class="text-sm text-zinc-400">Workspace <span class="mx-2 text-zinc-600">/</span> <span class="text-zinc-100">Emulator Control</span></span></div><div class="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs"><span class="size-2 rounded-full" :class="ready?'bg-emerald-400':'bg-zinc-500'"></span>{{ready?'Device connected':'Device offline'}}</div></header>
    <main class="mx-auto max-w-7xl space-y-7 px-5 py-8 md:px-9">
      <div class="flex flex-wrap items-start justify-between gap-4"><div><div class="mb-2 text-xs font-semibold tracking-widest text-indigo-400 uppercase">Android TV / Device management</div><h1 class="text-3xl font-semibold tracking-tight">Emulator Control</h1><p class="mt-2 text-sm text-zinc-400">Manage and operate your Android TV emulator from the browser.</p></div><button class="control gap-2 px-4 text-sm" @click="refreshStatus"><RefreshCw :size="16"/> Refresh status</button></div>
      <div v-if="message" class="flex items-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200"><AlertCircle :size="16"/> {{message}} <button class="ml-auto text-zinc-400" @click="message=''">×</button></div>
      <div class="grid gap-4 sm:grid-cols-3"><div class="panel p-5"><div class="flex items-center gap-2 text-xs text-zinc-400"><Wifi :size="16"/> Connection</div><div class="mt-3 text-xl font-semibold">{{ready?'Online':'Offline'}}</div><div class="mt-1 text-xs text-zinc-500">{{status?.serial||'Checking device...'}}</div></div><div class="panel p-5"><div class="flex items-center gap-2 text-xs text-zinc-400"><Tv :size="16"/> Virtual device</div><div class="mt-3 truncate text-xl font-semibold">{{status?.avd||'MulticastAndroidTV'}}</div><div class="mt-1 text-xs text-zinc-500">{{status?.model||'Android TV Emulator'}}</div></div><div class="panel p-5"><div class="flex items-center gap-2 text-xs text-zinc-400"><Monitor :size="16"/> Android status</div><div class="mt-3 text-xl font-semibold">{{status?.booted?'Ready':ready?'Booting':'Not running'}}</div><div class="mt-1 text-xs text-zinc-500">{{status?.size||'1280 × 720 configured'}}</div></div></div>
      <div class="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <section class="panel overflow-hidden"><div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4"><div><h2 class="font-semibold">Live screen</h2><p class="mt-1 text-xs text-zinc-500">Screenshot preview · lightweight mode</p></div><div class="flex items-center gap-2"><span class="pill">{{autoPreview?'Auto refresh':'Paused'}}</span><button class="control !min-h-9 px-3 text-xs" @click="autoPreview=!autoPreview">{{autoPreview?'Pause':'Resume'}}</button></div></div><div class="p-4 md:p-6"><div class="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-black"><img v-if="preview&&ready" :src="preview" alt="Android TV screen" class="h-full w-full object-contain"/><div v-else class="flex flex-col items-center gap-3 text-zinc-500"><component :is="ready?Monitor:WifiOff" :size="42" :stroke-width="1.3"/><span class="text-sm">{{ready?'Waiting for first screenshot':'Emulator is offline'}}</span></div><div class="absolute bottom-3 left-3 rounded-md bg-black/70 px-2 py-1 text-[11px] text-zinc-300">ANDROID TV · {{status?.serial||'emulator-5554'}}</div></div><div class="mt-4 flex flex-wrap items-center justify-between gap-3"><div class="text-xs text-zinc-500">Preview uses ADB screenshots. Streaming video remains independent.</div><button class="control !min-h-9 gap-2 px-3 text-xs" :disabled="!ready" @click="screenshot"><RefreshCw :size="14"/> Capture now</button></div></div></section>
        <section class="panel"><div class="flex border-b border-zinc-800"><button class="flex flex-1 items-center justify-center gap-2 py-4 text-sm" :class="activeTab==='remote'?'border-b-2 border-indigo-400 text-white':'text-zinc-500'" @click="activeTab='remote'"><Menu :size="16"/> Remote</button><button class="flex flex-1 items-center justify-center gap-2 py-4 text-sm" :class="activeTab==='settings'?'border-b-2 border-indigo-400 text-white':'text-zinc-500'" @click="activeTab='settings'"><Settings2 :size="16"/> Settings</button></div>
          <div v-if="activeTab==='remote'" class="space-y-6 p-5"><div class="flex justify-center gap-3"><button class="control size-12" :disabled="!ready" title="Home" @click="key('home')"><House :size="19"/></button><button class="control size-12" :disabled="!ready" title="Back" @click="key('back')"><ArrowLeft :size="19"/></button><button class="control size-12" :disabled="!ready" title="Menu" @click="key('menu')"><Menu :size="19"/></button></div><div class="mx-auto grid max-w-[214px] grid-cols-3 gap-2"><div></div><button class="control aspect-square" :disabled="!ready" aria-label="Up" @click="key('up')"><ChevronUp :size="27"/></button><div></div><button class="control aspect-square" :disabled="!ready" aria-label="Left" @click="key('left')"><ChevronLeft :size="27"/></button><button class="control aspect-square !border-indigo-500/40 !bg-indigo-500/20 text-indigo-300" :disabled="!ready" aria-label="Select" @click="key('ok')"><CircleDot :size="25"/></button><button class="control aspect-square" :disabled="!ready" aria-label="Right" @click="key('right')"><ChevronRight :size="27"/></button><div></div><button class="control aspect-square" :disabled="!ready" aria-label="Down" @click="key('down')"><ChevronDown :size="27"/></button></div><div class="flex justify-center gap-3 border-t border-zinc-800 pt-5"><button class="control size-12" :disabled="!ready" title="Volume down" @click="key('volumeDown')"><Volume1 :size="19"/></button><button class="control size-12" :disabled="!ready" title="Play / pause" @click="key('playPause')"><PlayPause :size="19"/></button><button class="control size-12" :disabled="!ready" title="Volume up" @click="key('volumeUp')"><Volume2 :size="19"/></button><button class="control size-12" :disabled="!ready" title="Mute" @click="key('mute')"><VolumeX :size="19"/></button></div><form class="flex gap-2" @submit.prevent="sendText"><input v-model="textInput" class="field min-w-0 flex-1 text-sm" maxlength="160" placeholder="Send text to Android" aria-label="Text to send"/><button class="control px-4" :disabled="!ready||!textInput" type="submit"><Keyboard :size="18"/></button></form><p class="text-center text-xs text-zinc-500">Keyboard arrows, Enter, Esc and Backspace also work.</p></div>
          <div v-else class="space-y-4 p-5"><label class="block text-sm text-zinc-300">API access token</label><input v-model="tokenInput" type="password" class="field w-full text-sm" placeholder="Token from MANAGER_TOKEN"/><button class="control w-full text-sm" @click="saveToken">Save for this browser session</button><p class="text-xs leading-5 text-zinc-500">Required when the API is configured with a token. Avoid exposing this service publicly.</p></div>
        </section>
      </div>
      <section class="panel p-5 md:p-6"><div class="flex flex-wrap items-center justify-between gap-4"><div><h2 class="font-semibold">Emulator lifecycle</h2><p class="mt-1 text-sm text-zinc-500">Start, reboot or gracefully stop the Android TV instance.</p></div><div class="flex flex-wrap gap-3"><button class="control gap-2 px-4 text-sm" :disabled="ready||!!loading" @click="action('start')"><Power :size="16" class="text-emerald-400"/> Start emulator</button><button class="control gap-2 px-4 text-sm" :disabled="!ready||!!loading" @click="action('restart')"><RotateCcw :size="16"/> Reboot Android</button><button class="control gap-2 px-4 text-sm text-rose-300" :disabled="!ready||!!loading" @click="action('stop')"><Power :size="16"/> Stop emulator</button></div></div></section>
      <footer class="pb-6 text-xs text-zinc-600">Android Emulator Manager · Multicast Studio integration foundation · v0.1.0</footer>
    </main>
  </div>
</div>
</template>
