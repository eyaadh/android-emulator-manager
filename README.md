# Android Emulator Manager — Multicast Studio companion

A lightweight Vue 3 / TypeScript / `<script setup>` / Tailwind CSS 4 control dashboard and Hono API for the Android TV emulator on Ubuntu. The attached Protocol design template was used as a visual reference; this is a **new standalone project**, not a patch to the Multicast Studio source tree.

## Features
- Emulator connection, boot status, and device information
- Android TV D-pad, OK, Home, Back, Menu, playback and volume controls
- Text entry (ASCII), browser keyboard shortcuts
- Periodic ADB screenshot preview (not a live video stream)
- Start emulator, reboot Android, stop emulator
- Token-protected API when deployed to a management network

## Install (on SVAKEMANDROID01)

```bash
unzip android-emulator-manager.zip
cd android-emulator-manager
npm install
cp .env.example .env
# Edit paths, address, and MANAGER_TOKEN as needed
set -a; source .env; set +a
npm run build
npm start
```

The API and built Vue app listen on `127.0.0.1:3100` by default. To access from your Mac without exposing the API:

```bash
ssh -L 3100:127.0.0.1:3100 vakadmin@10.50.0.190
```

Then open `http://127.0.0.1:3100` on your Mac.

For LAN access, set `HOST=10.50.0.190` and **set a strong `MANAGER_TOKEN`**. Enter the same token under the dashboard Settings tab. Place behind HTTPS and network access controls for persistent deployment.

## Development

```bash
npm install
cp .env.example .env
set -a; source .env; set +a
npm run dev
```

Vite: `http://127.0.0.1:5173` (API proxy to port 3100).

## Important operational notes

- Starting the emulator from the web interface uses `-gpu software`, 4096 MB, 6 cores, and headless mode. Existing manually started emulators can be controlled without restarting them. Starting an emulator from a service account requires correct AVD home, KVM permissions and runtime environment.
- **Do not run this backend as root.** Use the same Ubuntu account as the emulator (`vakadmin`).
- `Restart` reboots Android through ADB, not the entire Ubuntu VM.
- ADB screenshot polling is intentionally separate from scrcpy / FFmpeg. Frequent captures can increase emulator load; use Pause if video performance suffers.
- The existing MPEG-TS live feed is **not changed** by this application.
- `MANAGER_TOKEN` is a simple initial access control. The long-term integration should reuse Multicast Studio's authenticated admin session and CSRF/origin protections.
- The browser's text input is limited to printable ASCII. Some special characters may need additional escaping for Android's input utility.
- For a managed boot service, we should add a dedicated systemd unit after confirming the emulator runtime environment.
