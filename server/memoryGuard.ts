import { readFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';

const MiB = 1024 * 1024;

export type MemoryLevel = 'normal' | 'warning' | 'critical';

export interface MemorySnapshot {
  totalBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  pressureSomeAvg10: number | null;
  pressureFullAvg10: number | null;
  cgroupLimitBytes: number | null;
}

export interface MemoryGuardSettings {
  guestMemoryMb: number;
  reserveMb: number;
  startupOverheadMb: number;
  warningAvailableMb: number;
  criticalAvailableMb: number;
}

export function envInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

function maybeRead(path: string): string | null {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

export function parseMeminfo(text: string): Record<string, number> {
  const values: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_()]+):\s+(\d+)\s+kB/.exec(line);
    if (match) values[match[1]] = Number(match[2]) * 1024;
  }
  return values;
}

export function parsePressure(text: string | null, key: 'some' | 'full'): number | null {
  const line = text?.split('\n').find((item) => item.startsWith(`${key} `));
  const value = line?.match(/\bavg10=([0-9.]+)/)?.[1];
  return value === undefined ? null : Number(value);
}

export function readMemorySnapshot(): MemorySnapshot {
  const meminfo = parseMeminfo(maybeRead('/proc/meminfo') || '');
  const physicalTotal = meminfo.MemTotal || totalmem();
  const physicalAvailable = meminfo.MemAvailable ?? freemem();
  const swapTotal = meminfo.SwapTotal || 0;
  const swapFree = meminfo.SwapFree ?? 0;
  // Honour a systemd/cgroup-v2 memory limit when one is configured. This is
  // a safety check, not a way of increasing the VM's physical memory.
  const rawLimit = maybeRead('/sys/fs/cgroup/memory.max')?.trim();
  const rawCurrent = maybeRead('/sys/fs/cgroup/memory.current')?.trim();
  const cgroupLimit = rawLimit && /^\d+$/.test(rawLimit) ? Number(rawLimit) : null;
  const cgroupCurrent = rawCurrent && /^\d+$/.test(rawCurrent) ? Number(rawCurrent) : null;
  const limited = cgroupLimit !== null && Number.isSafeInteger(cgroupLimit) && cgroupLimit < physicalTotal;
  const totalBytes = limited && cgroupLimit !== null ? cgroupLimit : physicalTotal;
  const availableBytes = limited && cgroupLimit !== null && cgroupCurrent !== null
    ? Math.max(0, Math.min(physicalAvailable, cgroupLimit - cgroupCurrent))
    : physicalAvailable;
  const psi = maybeRead('/proc/pressure/memory');
  return {
    totalBytes,
    availableBytes,
    swapTotalBytes: swapTotal,
    swapUsedBytes: Math.max(0, swapTotal - swapFree),
    pressureSomeAvg10: parsePressure(psi, 'some'),
    pressureFullAvg10: parsePressure(psi, 'full'),
    cgroupLimitBytes: limited ? cgroupLimit : null,
  };
}

export function classifyMemory(snapshot: MemorySnapshot, settings: MemoryGuardSettings): MemoryLevel {
  if (snapshot.availableBytes < settings.criticalAvailableMb * MiB) return 'critical';
  if (snapshot.availableBytes < settings.warningAvailableMb * MiB) return 'warning';
  return 'normal';
}

export function checkEmulatorStart(snapshot: MemorySnapshot, settings: MemoryGuardSettings): string | null {
  const requiredTotalMb = settings.guestMemoryMb + settings.startupOverheadMb;
  const requiredAvailableMb = settings.guestMemoryMb + settings.reserveMb;
  if (snapshot.totalBytes < requiredTotalMb * MiB)
    return `Insufficient host RAM: the ${settings.guestMemoryMb} MB Android guest needs at least ${requiredTotalMb} MB of host RAM including emulator/OS overhead. Increase VM RAM or lower EMULATOR_MEMORY_MB.`;
  if (snapshot.availableBytes < requiredAvailableMb * MiB)
    return `Insufficient available RAM: need at least ${requiredAvailableMb} MB before starting, but only ${Math.floor(snapshot.availableBytes / MiB)} MB is available. Close other processes, increase VM RAM, or lower EMULATOR_MEMORY_MB.`;
  return null;
}
