import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { timingSafeEqual } from 'node:crypto'

const run = promisify(execFile)
const ADB = process.env.ADB_PATH || 'adb'
const EMULATOR = process.env.EMULATOR_PATH || resolve(process.env.HOME || '/home/vakadmin', 'android-sdk/emulator/emulator')
const SERIAL = process.env.ANDROID_SERIAL || 'emulator-5554'
const AVD = process.env.AVD_NAME || 'MulticastAndroidTV'
const PORT = Number(process.env.PORT || 3100)
const HOST = process.env.HOST || '127.0.0.1'
const TOKEN = process.env.MANAGER_TOKEN || ''
const app = new Hono()
let managed: ChildProcess | undefined
let busy = false

// Require an API token for non-loopback deployment. Keep ADB local to this host.
if (HOST !== '127.0.0.1' && HOST !== '::1' && !TOKEN) throw Error('MANAGER_TOKEN is required when binding to a non-loopback address')
app.use('/api/*', async (c, next) => {
  if (TOKEN) {
    const value = c.req.header('authorization')?.replace(/^Bearer /i, '') || ''
    const a = Buffer.from(value), b = Buffer.from(TOKEN)
    if (a.length !== b.length || !timingSafeEqual(a,b)) return c.json({error:'Unauthorized'},401)
  }
  await next()
})
const adb = async (...args: string[]) => (await run(ADB,['-s',SERIAL,...args],{timeout:10000,maxBuffer:8*1024*1024})).stdout.trim()
async function connected(){try{return (await adb('get-state'))==='device'}catch{return false}}
async function status(){
  const online=await connected()
  let booted=false, model='', size=''
  if(online){try{booted=(await adb('shell','getprop','sys.boot_completed'))==='1';model=await adb('shell','getprop','ro.product.model');size=await adb('shell','wm','size')}catch{}}
  return {online,booted,model,size,serial:SERIAL,avd:AVD,managed:!!managed,starting:busy}
}
app.get('/api/emulator/status',async c=>c.json(await status()))
const keys:Record<string,number>={home:3,back:4,up:19,down:20,left:21,right:22,ok:23,volumeUp:24,volumeDown:25,mute:164,playPause:85,power:26,menu:82}
app.post('/api/emulator/keyevent',async c=>{
  const body=await c.req.json().catch(()=>({})) as {key?:string}
  if(!body.key || !(body.key in keys)) return c.json({error:'Unsupported key'},400)
  if(!await connected())return c.json({error:'Emulator offline'},409)
  try{await adb('shell','input','keyevent',String(keys[body.key]));return c.json({ok:true})}catch{return c.json({error:'ADB command failed'},500)}
})
app.get('/api/emulator/screenshot',async c=>{
  if(!await connected())return c.json({error:'Emulator offline'},409)
  try{
    const {stdout}=await run(ADB,['-s',SERIAL,'exec-out','screencap','-p'],{encoding:'buffer',timeout:12000,maxBuffer:12*1024*1024})
    c.header('Cache-Control','no-store');c.header('Content-Type','image/png');return c.body(new Uint8Array(stdout))
  }catch{return c.json({error:'Screenshot failed'},500)}
})
app.post('/api/emulator/start',async c=>{
  if(busy || await connected())return c.json({error:'Emulator is already running or starting'},409)
  busy=true
  try{
    managed=spawn(EMULATOR,['-avd',AVD,'-no-window','-no-boot-anim','-no-snapshot','-gpu','software','-accel','on','-memory','4096','-cores','6','-no-metrics'],{stdio:'ignore',env:process.env})
    managed.on('error',e=>{console.error('Emulator spawn failed:',e);managed=undefined;busy=false})
    managed.on('exit',()=>{managed=undefined;busy=false})
    busy=false
    return c.json({ok:true,notice:'Emulator starting; allow time for Android to boot'})
  }catch{busy=false;return c.json({error:'Unable to start emulator'},500)}
})
app.post('/api/emulator/stop',async c=>{
  if(!await connected())return c.json({error:'Emulator offline'},409)
  try{await adb('emu','kill');return c.json({ok:true})}catch{return c.json({error:'Unable to stop emulator'},500)}
})
app.post('/api/emulator/restart',async c=>{
  if(!await connected())return c.json({error:'Emulator offline'},409)
  try{await adb('reboot');return c.json({ok:true,notice:'Android is rebooting'})}catch{return c.json({error:'Unable to reboot Android'},500)}
})
app.post('/api/emulator/text',async c=>{
  const body=await c.req.json().catch(()=>({})) as {text?:string}
  if(typeof body.text!=='string'||body.text.length>160||!body.text||/[^\x20-\x7E]/.test(body.text))return c.json({error:'Text must be 1–160 ASCII characters'},400)
  if(!await connected())return c.json({error:'Emulator offline'},409)
  try{await adb('shell','input','text',body.text.replace(/ /g,'%s'));return c.json({ok:true})}catch{return c.json({error:'Text entry failed'},500)}
})
app.get('/api/healthz',c=>c.json({ok:true}))
const dist=resolve('dist')
if(existsSync(dist)){
 app.use('/*',serveStatic({root:'./dist'}))
 app.get('*',c=>c.html(readFileSync(resolve(dist,'index.html'),'utf8')))
}
serve({fetch:app.fetch,port:PORT,hostname:HOST},()=>console.log(`Emulator Manager: http://${HOST}:${PORT}`))
