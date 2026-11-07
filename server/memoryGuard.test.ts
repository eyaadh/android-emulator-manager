import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEmulatorStart, classifyMemory, parseMeminfo, parsePressure, type MemoryGuardSettings, type MemorySnapshot } from './memoryGuard.ts';

const MiB = 1024 * 1024;
const settings: MemoryGuardSettings = {
  guestMemoryMb: 4096,
  reserveMb: 1536,
  startupOverheadMb: 2048,
  warningAvailableMb: 1536,
  criticalAvailableMb: 768,
};
const snapshot = (totalMb: number, availableMb: number): MemorySnapshot => ({
  totalBytes: totalMb * MiB,
  availableBytes: availableMb * MiB,
  swapTotalBytes: 0,
  swapUsedBytes: 0,
  pressureSomeAvg10: null,
  pressureFullAvg10: null,
  cgroupLimitBytes: null,
});

test('parse Linux MemAvailable and swap values in bytes', () => {
  assert.deepEqual(parseMeminfo('MemTotal:       8192000 kB\nMemAvailable:   4500000 kB\nSwapTotal:      1024000 kB\n'), {
    MemTotal: 8192000 * 1024,
    MemAvailable: 4500000 * 1024,
    SwapTotal: 1024000 * 1024,
  });
});

test('classify normal/warning/critical headroom at boundaries', () => {
  assert.equal(classifyMemory(snapshot(8192, 1600), settings), 'normal');
  assert.equal(classifyMemory(snapshot(8192, 1535), settings), 'warning');
  assert.equal(classifyMemory(snapshot(8192, 767), settings), 'critical');
  assert.equal(classifyMemory(snapshot(8192, 768), settings), 'warning');
});

test('deny 4GiB Android guest on undersized host', () => {
  assert.match(checkEmulatorStart(snapshot(4096, 3500), settings) || '', /Insufficient host RAM/);
  assert.match(checkEmulatorStart(snapshot(8192, 4500), settings) || '', /Insufficient available RAM/);
  assert.equal(checkEmulatorStart(snapshot(8192, 6500), settings), null);
});

test('parse memory PSI without depending on availability', () => {
  const psi = 'some avg10=8.05 avg60=4.00 avg300=2.50 total=100\nfull avg10=1.25 avg60=0.50 avg300=0.20 total=10\n';
  assert.equal(parsePressure(psi, 'some'), 8.05);
  assert.equal(parsePressure(psi, 'full'), 1.25);
  assert.equal(parsePressure(null, 'some'), null);
});
