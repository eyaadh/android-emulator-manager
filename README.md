# Android Emulator Manager

Standalone Vue 3 / TypeScript (`<script setup>`) / Tailwind CSS 4 dashboard with Hono API, styled to match the Protocol-inspired Multicast Studio interface.

## Features

- Password login from `ADMIN_PASSWORD` in `.env`, signed HTTP-only 12-hour session cookie, origin checks and login throttling
- Android TV screenshot preview, D-pad, Home, Back, volume, text entry
- Start headless emulator, stop emulator, reboot Android
- Start/stop scrcpy + FFmpeg live HTTP MPEG-TS pipeline; create FIFO if missing, verify dependencies
- Host CPU utilization, memory usage, load average and core count
- Process logs, stream URL and status

## 1. Ubuntu 24.04 prerequisites (install manually)

Use the normal Ubuntu user who owns the Android SDK and AVD (e.g. `vakadmin`); **do not run the manager as root**.

```bash
sudo apt update
sudo apt install -y ffmpeg adb curl unzip openjdk-17-jdk libgl1 libpulse0
sudo apt install -y scrcpy  # Check version: recent scrcpy (3.x) is required
ffmpeg -version
scrcpy --version
adb version
```

Ubuntu repository scrcpy may be too old. If `scrcpy --version` reports older than 3.x, install a recent official Linux release from https://github.com/Genymobile/scrcpy/releases and set `SCRCPY_PATH` accordingly. The manager does not install FFmpeg, scrcpy, Android SDK or emulator.

Install Node.js 22+ separately and verify `node --version`.

## 2. Android SDK and Android TV AVD (manual installation)

Download the Android command-line tools for Linux from https://developer.android.com/studio#command-tools and extract under `~/android-sdk/cmdline-tools/latest/` so `sdkmanager` is at `~/android-sdk/cmdline-tools/latest/bin/sdkmanager`. Add tools to PATH:

```bash
export ANDROID_HOME="$HOME/android-sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
sdkmanager --licenses
sdkmanager 'platform-tools' 'emulator' 'system-images;android-36;android-tv;x86_64'
avdmanager create avd -n MulticastAndroidTV -k 'system-images;android-36;android-tv;x86_64'
```

Ensure the Ubuntu VM has nested virtualization/KVM available (`ls -l /dev/kvm`) and that the service user can access it. The image/AVD above matches the tested Android TV 16 environment; SDK packages and licensing may change.

Manual emulator launch, matching the web manager's defaults:

```bash
~/android-sdk/emulator/emulator \
  -avd MulticastAndroidTV \
  -no-window -no-boot-anim -no-snapshot \
  -gpu software -accel on -memory 4096 -cores 6 \
  2>&1 | tee ~/emulator-software-gpu.log
```

You can alternatively start it from the GUI. `Reboot Android` issues `adb reboot`; `Stop emulator` issues `adb emu kill`. Do not start the same AVD twice.

## 3. Install and configure manager

```bash
npm install
cp .env.example .env
openssl rand -hex 32   # use output as SESSION_SECRET
nano .env              # set strong ADMIN_PASSWORD, SESSION_SECRET and paths
chmod 600 .env
set -a; source .env; set +a
npm run build
npm start
```

**Environment variables must be loaded into the Node process**; the app does not automatically parse `.env` when launched with `npm start`. When running under systemd, use `EnvironmentFile=/path/to/.env` and run as the SDK/AVD owner.

From the management LAN, open `http://10.50.0.190:3100` (or your configured `HOST:PORT`). No SSH tunnel is required. Use the administrator password to sign in. Restrict TCP 3100 and 8080 to authorized management/receiver networks. For remote/untrusted access use HTTPS via a reverse proxy and `COOKIE_SECURE=true`.

## 4. Start the live stream

Boot the emulator and verify Android is online. In the GUI, select **Start stream**. The backend checks `ffmpeg` and `scrcpy`, creates `STREAM_PIPE` with mode 0600 if missing (refuses to overwrite an existing non-FIFO file), then launches FFmpeg and scrcpy. FFmpeg passes H.264 video through unchanged (`-c:v copy`) and converts Opus audio to AAC. Default output:

```text
http://10.50.0.190:8080/live.ts
```

Open this URL in VLC (File → Open Network). **FFmpeg `-listen 1` is a single-client test server**; it is not multi-client IPTV distribution. The stream is live, not playback of an existing recording. The Matroska FIFO technique depends on scrcpy's recorder accepting a FIFO and should be validated on your installed scrcpy build; a failed startup will be visible in process output. Stop a stream before stopping the emulator.

**Important:** `STREAM_PIPE` must be a FIFO. If you previously created `~/android-live.mkv` as a regular recording file, rename it manually first; the manager will never overwrite it. The FIFO is created only when needed. Stopping the stream does not delete the FIFO.

## 5. Operational and security notes

- This version reports **host** CPU and RAM, not per-process usage. Emulator performance may still be constrained by software rendering.
- Screenshots are independent of the stream and can add CPU load; pause auto-preview when needed.
- Stream start/stop controls only child processes launched by the current manager process. Existing manually launched FFmpeg/scrcpy processes are not adopted. A service restart stops manager ownership of existing children; run under systemd with `KillMode=control-group` and configure appropriate shutdown handling before unattended production.
- The current stream status is based on process liveness, not confirmed VLC playback or outgoing packets.
- Do not expose ADB or emulator console ports publicly.
- Do not use this test stream to redistribute content without the necessary rights.
