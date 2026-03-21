/**
 * Web Bluetooth VBT (Velocity-Based Training) integration.
 *
 * Connects to bar velocity sensors (RepOne, GymAware, OpenBarbell, generic BLE
 * accelerometers) via the Web Bluetooth API.  Provides velocity zone
 * classification, RPE estimation from bar speed, fatigue-based stopping
 * (velocity loss), and load-velocity 1RM estimation.
 *
 * References:
 * - Jovanovic & Flanagan (2014) — velocity zones / autoregulation
 * - Sanchez-Medina & Gonzalez-Badillo (2011) — velocity loss & fatigue
 * - Jidovtseff et al. (2011) — load-velocity 1RM estimation
 * - Conceicao et al. (2016) — minimum velocity thresholds (MVT)
 * - Gonzalez-Badillo & Sanchez-Medina (2010) — exercise-specific MVT
 */

/** DOM-free HTML escaping for use in non-DOM test environments */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Web Bluetooth Type Shims ───
// Web Bluetooth types are not in the standard DOM lib.
// We declare minimal interfaces so the module compiles
// without requiring @types/web-bluetooth.

/* eslint-disable @typescript-eslint/no-explicit-any */
interface BLEDevice {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<BLEServer>;
    disconnect(): void;
  };
  addEventListener(type: string, listener: () => void): void;
}
interface BLEServer {
  getPrimaryService(service: number | string): Promise<BLEService>;
}
interface BLEService {
  getCharacteristic(characteristic: string): Promise<BLECharacteristic>;
}
interface BLECharacteristic {
  value: DataView | null;
  startNotifications(): Promise<BLECharacteristic>;
  stopNotifications(): Promise<BLECharacteristic>;
  readValue(): Promise<DataView>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}
interface BLEBluetooth {
  requestDevice(options: any): Promise<BLEDevice>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Types ───

export interface VBTDevice {
  name: string;
  id: string;
  type: 'repone' | 'gymaware' | 'openbarbell' | 'generic';
  connected: boolean;
  batteryLevel?: number;
}

export interface VelocityReading {
  timestamp: number;
  meanVelocity: number;      // m/s — mean concentric velocity
  peakVelocity: number;      // m/s — peak concentric velocity
  rom: number;               // mm — range of motion
  duration: number;          // ms — concentric phase duration
  power?: number;            // watts (if available)
}

export interface VBTSession {
  device: VBTDevice;
  readings: VelocityReading[];
  startTime: number;
  exercise?: string;
}

// ─── Known BLE Service UUIDs ───

/** Bluetooth Fitness Machine Service (used by RepOne and many devices). */
const FITNESS_MACHINE_SERVICE = 0x1826;
/** RepOne-specific measurement characteristic. */
const REPONE_MEASUREMENT_CHAR = '00002ad2-0000-1000-8000-00805f9b34fb';
/** GymAware custom service UUID. */
const GYMAWARE_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
/** GymAware TX characteristic. */
const GYMAWARE_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
/** OpenBarbell custom service UUID. */
const OPENBARBELL_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
/** OpenBarbell measurement characteristic. */
const OPENBARBELL_CHAR = '0000fff1-0000-1000-8000-00805f9b34fb';

// ─── Module State ───

let connectedDevice: VBTDevice | null = null;
let bluetoothDevice: BLEDevice | null = null;
let characteristic: BLECharacteristic | null = null;
let velocityCallback: ((reading: VelocityReading) => void) | null = null;
let activeSession: VBTSession | null = null;

// ─── Velocity Zones (Jovanovic & Flanagan, 2014) ───

export interface VelocityZone {
  zone: 'strength_speed' | 'speed_strength' | 'strength' | 'maximal_strength';
  minVelocity: number;  // m/s
  maxVelocity: number;  // m/s
  description: string;
  rpeEstimate: number;
  percentOf1RM: [number, number];
}

export const VELOCITY_ZONES: VelocityZone[] = [
  {
    zone: 'strength_speed',
    minVelocity: 0.75,
    maxVelocity: 1.0,
    description: 'Strength-Speed — explosive power with moderate load',
    rpeEstimate: 5.5,
    percentOf1RM: [55, 70],
  },
  {
    zone: 'speed_strength',
    minVelocity: 0.5,
    maxVelocity: 0.75,
    description: 'Speed-Strength — balanced speed and force',
    rpeEstimate: 6.75,
    percentOf1RM: [70, 80],
  },
  {
    zone: 'strength',
    minVelocity: 0.3,
    maxVelocity: 0.5,
    description: 'Strength — heavy grinding reps',
    rpeEstimate: 8.25,
    percentOf1RM: [80, 90],
  },
  {
    zone: 'maximal_strength',
    minVelocity: 0,
    maxVelocity: 0.3,
    description: 'Maximal Strength — near-maximal / 1RM territory',
    rpeEstimate: 9.5,
    percentOf1RM: [90, 100],
  },
];

// ─── Connection ───

/**
 * Check if Web Bluetooth is available in this browser.
 * Mainly supported in Chrome, Edge, and Opera on desktop/Android.
 */
export function isBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' &&
    (navigator as unknown as { bluetooth?: BLEBluetooth }).bluetooth !== undefined &&
    typeof (navigator as unknown as { bluetooth?: BLEBluetooth }).bluetooth?.requestDevice === 'function';
}

/** Internal accessor for navigator.bluetooth, typed via our shim. */
function getBluetooth(): BLEBluetooth {
  return (navigator as unknown as { bluetooth: BLEBluetooth }).bluetooth;
}

/**
 * Detect device type from its advertised name.
 */
function detectDeviceType(name: string): VBTDevice['type'] {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('repone') || lower.includes('rep one')) return 'repone';
  if (lower.includes('gymaware') || lower.includes('gympro')) return 'gymaware';
  if (lower.includes('openbarbell') || lower.includes('open barbell')) return 'openbarbell';
  return 'generic';
}

/**
 * Parse a velocity reading from a raw BLE characteristic value.
 * Format varies by device; we handle RepOne/generic (little-endian floats)
 * and fall back to basic parsing for unknown devices.
 */
function parseVelocityReading(data: DataView, deviceType: VBTDevice['type']): VelocityReading | null {
  try {
    if (deviceType === 'repone' && data.byteLength >= 12) {
      // RepOne: 3 × float32 LE — mean velocity, peak velocity, ROM (mm)
      const meanVelocity = data.getFloat32(0, true);
      const peakVelocity = data.getFloat32(4, true);
      const rom = data.getFloat32(8, true);
      const duration = data.byteLength >= 16 ? data.getFloat32(12, true) : rom / Math.max(meanVelocity, 0.01) * 1000;
      const power = data.byteLength >= 20 ? data.getFloat32(16, true) : undefined;
      return { timestamp: Date.now(), meanVelocity, peakVelocity, rom, duration, power };
    }

    if (deviceType === 'gymaware' && data.byteLength >= 8) {
      // GymAware UART: mean velocity (float32), peak velocity (float32)
      const meanVelocity = data.getFloat32(0, true);
      const peakVelocity = data.getFloat32(4, true);
      const rom = data.byteLength >= 12 ? data.getFloat32(8, true) : 0;
      const duration = data.byteLength >= 16 ? data.getFloat32(12, true) : 0;
      return { timestamp: Date.now(), meanVelocity, peakVelocity, rom, duration };
    }

    if (deviceType === 'openbarbell' && data.byteLength >= 8) {
      // OpenBarbell: 2 × uint16 (velocity cm/s, ROM mm) then duration uint16
      const meanVelCmS = data.getUint16(0, true);
      const peakVelCmS = data.getUint16(2, true);
      const rom = data.getUint16(4, true);
      const duration = data.byteLength >= 8 ? data.getUint16(6, true) : 0;
      return {
        timestamp: Date.now(),
        meanVelocity: meanVelCmS / 100,
        peakVelocity: peakVelCmS / 100,
        rom,
        duration,
      };
    }

    // Generic: try float32 pair
    if (data.byteLength >= 8) {
      const meanVelocity = data.getFloat32(0, true);
      const peakVelocity = data.getFloat32(4, true);
      if (meanVelocity > 0 && meanVelocity < 5 && peakVelocity > 0 && peakVelocity < 8) {
        const rom = data.byteLength >= 12 ? data.getFloat32(8, true) : 0;
        const duration = data.byteLength >= 16 ? data.getFloat32(12, true) : 0;
        return { timestamp: Date.now(), meanVelocity, peakVelocity, rom, duration };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Notification handler wired to the BLE characteristic.
 */
function handleCharacteristicNotification(event: Event): void {
  const target = event.target as unknown as BLECharacteristic;
  if (!target.value) return;

  const deviceType = connectedDevice?.type ?? 'generic';
  const reading = parseVelocityReading(target.value, deviceType);
  if (!reading) return;

  // Append to active session
  if (activeSession) {
    activeSession.readings.push(reading);
  }

  // Fire user callback
  if (velocityCallback) {
    velocityCallback(reading);
  }
}

/**
 * Scan for and connect to a VBT device.
 * Uses the Web Bluetooth API `requestDevice()` which shows a browser picker.
 *
 * Known device service UUIDs:
 * - RepOne: service UUID 0x1826 (Fitness Machine Service)
 * - GymAware: custom UART service
 * - OpenBarbell: custom service 0xFFF0
 * - Generic: look for devices advertising accelerometer/force data
 */
export async function connectVBTDevice(): Promise<VBTDevice> {
  if (!isBluetoothAvailable()) {
    throw new Error('Web Bluetooth is not available in this browser. Use Chrome, Edge, or Opera.');
  }

  // Request a device that advertises any of the known services
  const device = await getBluetooth().requestDevice({
    filters: [
      { services: [FITNESS_MACHINE_SERVICE] },
      { services: [GYMAWARE_SERVICE] },
      { services: [OPENBARBELL_SERVICE] },
    ],
    optionalServices: [
      FITNESS_MACHINE_SERVICE,
      GYMAWARE_SERVICE,
      OPENBARBELL_SERVICE,
      'battery_service',
    ],
  });

  if (!device) {
    throw new Error('No VBT device selected.');
  }

  bluetoothDevice = device;
  const deviceType = detectDeviceType(device.name ?? '');

  // Connect GATT server
  const server = await device.gatt!.connect();

  // Try to read battery level
  let batteryLevel: number | undefined;
  try {
    const batteryService = await server.getPrimaryService('battery_service');
    const batteryChar = await batteryService.getCharacteristic('battery_level');
    const batteryValue = await batteryChar.readValue();
    batteryLevel = batteryValue.getUint8(0);
  } catch {
    // Battery service not available — that's fine
  }

  // Subscribe to the appropriate measurement characteristic
  try {
    if (deviceType === 'repone' || deviceType === 'generic') {
      const service = await server.getPrimaryService(FITNESS_MACHINE_SERVICE);
      characteristic = await service.getCharacteristic(REPONE_MEASUREMENT_CHAR);
    } else if (deviceType === 'gymaware') {
      const service = await server.getPrimaryService(GYMAWARE_SERVICE);
      characteristic = await service.getCharacteristic(GYMAWARE_TX_CHAR);
    } else if (deviceType === 'openbarbell') {
      const service = await server.getPrimaryService(OPENBARBELL_SERVICE);
      characteristic = await service.getCharacteristic(OPENBARBELL_CHAR);
    }

    if (characteristic) {
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicNotification);
    }
  } catch {
    // Could not subscribe; device is connected but may not stream data
  }

  // Disconnect handler
  device.addEventListener('gattserverdisconnected', () => {
    if (connectedDevice) {
      connectedDevice.connected = false;
    }
    characteristic = null;
  });

  connectedDevice = {
    name: device.name ?? 'Unknown VBT Device',
    id: device.id,
    type: deviceType,
    connected: true,
    batteryLevel,
  };

  return connectedDevice;
}

/**
 * Disconnect from the current VBT device.
 */
export async function disconnectVBTDevice(): Promise<void> {
  if (characteristic) {
    try {
      characteristic.removeEventListener('characteristicvaluechanged', handleCharacteristicNotification);
      await characteristic.stopNotifications();
    } catch {
      // Already disconnected
    }
    characteristic = null;
  }

  if (bluetoothDevice?.gatt?.connected) {
    bluetoothDevice.gatt.disconnect();
  }

  if (connectedDevice) {
    connectedDevice.connected = false;
  }
  connectedDevice = null;
  bluetoothDevice = null;
}

/**
 * Subscribe to velocity readings from the connected device.
 * Calls the callback for each rep detected by the device.
 */
export function onVelocityReading(callback: (reading: VelocityReading) => void): void {
  velocityCallback = callback;
}

/**
 * Unsubscribe from velocity readings.
 */
export function offVelocityReading(): void {
  velocityCallback = null;
}

// ─── VBT Analysis ───

/**
 * Classify a velocity into its training zone.
 */
export function classifyVelocityZone(velocity: number): VelocityZone {
  for (const zone of VELOCITY_ZONES) {
    if (velocity >= zone.minVelocity && velocity < zone.maxVelocity) {
      return zone;
    }
  }
  // Velocities >= 1.0 m/s are above the strength-speed zone (warm-up territory)
  if (velocity >= 1.0) return VELOCITY_ZONES[0]; // strength_speed
  // Velocities < 0 shouldn't happen, but return maximal_strength
  return VELOCITY_ZONES[3]; // maximal_strength
}

/**
 * Minimum velocity thresholds (MVT) per exercise — the velocity at true 1RM.
 * Reference: Conceicao et al. (2016); Gonzalez-Badillo & Sanchez-Medina (2010).
 */
const MIN_VELOCITY_THRESHOLDS: Record<string, number> = {
  squat: 0.30,
  deadlift: 0.15,
  bench_press: 0.17,
  overhead_press: 0.25,
  barbell_row: 0.20,
  lunge: 0.28,
};

/**
 * Get the minimum velocity threshold for an exercise (velocity at 1RM).
 * Reference: Conceicao et al. (2016).
 */
export function getMinVelocityThreshold(exercise: string): number {
  return MIN_VELOCITY_THRESHOLDS[exercise] ?? 0.25;
}

/**
 * Estimate RPE from bar velocity for a given exercise.
 *
 * Uses a piecewise linear mapping from velocity to RPE, anchored at:
 * - MVT → RPE 10 (true 1RM)
 * - 1.0 m/s → RPE 5 (warm-up territory)
 *
 * This is more accurate than angular velocity because bar velocity
 * directly reflects the lifter's force output against load.
 */
export function estimateRPEFromVelocity(velocity: number, exercise: string): number {
  const mvt = getMinVelocityThreshold(exercise);

  // Clamp velocity to reasonable range
  const v = Math.max(0, Math.min(1.3, velocity));

  if (v <= mvt) return 10;
  if (v >= 1.0) return 5;

  // Linear interpolation: mvt → 10, 1.0 → 5
  const ratio = (v - mvt) / (1.0 - mvt);
  return Math.round((10 - ratio * 5) * 10) / 10; // round to 0.1
}

/**
 * Detect velocity loss within a set for fatigue-based stopping.
 * If velocity drops >20% from the first rep, the set should end.
 * Reference: Sanchez-Medina & Gonzalez-Badillo (2011).
 */
export function detectVelocityLoss(readings: VelocityReading[]): {
  velocityLoss: number;
  shouldStop: boolean;
  repsSinceThreshold: number;
  firstRepVelocity: number;
  lastRepVelocity: number;
} {
  if (readings.length === 0) {
    return {
      velocityLoss: 0,
      shouldStop: false,
      repsSinceThreshold: 0,
      firstRepVelocity: 0,
      lastRepVelocity: 0,
    };
  }

  const firstRepVelocity = readings[0].meanVelocity;
  const lastRepVelocity = readings[readings.length - 1].meanVelocity;

  if (firstRepVelocity <= 0) {
    return {
      velocityLoss: 0,
      shouldStop: false,
      repsSinceThreshold: 0,
      firstRepVelocity,
      lastRepVelocity,
    };
  }

  const rawLoss = ((firstRepVelocity - lastRepVelocity) / firstRepVelocity) * 100;
  // Round to 1 decimal to avoid floating-point edge cases (e.g. 19.999… vs 20)
  const velocityLoss = Math.round(rawLoss * 10) / 10;

  // Find when the threshold was first exceeded
  let repsSinceThreshold = 0;
  for (let i = 1; i < readings.length; i++) {
    const loss = Math.round(((firstRepVelocity - readings[i].meanVelocity) / firstRepVelocity) * 1000) / 10;
    if (loss >= 20) {
      repsSinceThreshold = readings.length - i;
      break;
    }
  }

  return {
    velocityLoss,
    shouldStop: velocityLoss >= 20,
    repsSinceThreshold,
    firstRepVelocity,
    lastRepVelocity,
  };
}

/**
 * Estimate 1RM from a load-velocity profile using linear regression.
 * The load–velocity relationship is approximately linear; we extrapolate
 * to the minimum velocity threshold (MVT) for the exercise.
 *
 * Reference: Jidovtseff et al. (2011).
 *
 * Requires at least 2 data points. More points → better accuracy.
 */
export function estimate1RMFromVelocity(
  loadVelocityPairs: Array<{ weight: number; velocity: number }>,
  exercise: string,
): { estimated1RM: number; r2: number; confidence: 'high' | 'medium' | 'low' } {
  if (loadVelocityPairs.length < 2) {
    return { estimated1RM: 0, r2: 0, confidence: 'low' };
  }

  const n = loadVelocityPairs.length;

  // Simple linear regression: velocity = a + b * weight
  // Then solve for weight when velocity = MVT
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const pair of loadVelocityPairs) {
    sumX += pair.weight;
    sumY += pair.velocity;
    sumXY += pair.weight * pair.velocity;
    sumX2 += pair.weight * pair.weight;
    sumY2 += pair.velocity * pair.velocity;
  }

  const meanX = sumX / n;
  const meanY = sumY / n;

  const ssXX = sumX2 - n * meanX * meanX;
  const ssXY = sumXY - n * meanX * meanY;
  const ssYY = sumY2 - n * meanY * meanY;

  if (ssXX === 0) {
    return { estimated1RM: 0, r2: 0, confidence: 'low' };
  }

  // Slope and intercept: velocity = intercept + slope * weight
  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;

  // R² — coefficient of determination
  const r2 = ssYY > 0 ? (ssXY * ssXY) / (ssXX * ssYY) : 0;

  // Solve for weight at MVT: MVT = intercept + slope * weight
  // weight = (MVT - intercept) / slope
  const mvt = getMinVelocityThreshold(exercise);

  if (slope >= 0) {
    // Velocity should decrease as weight increases (negative slope).
    // If slope is non-negative, the data is invalid.
    return { estimated1RM: 0, r2: Math.round(r2 * 1000) / 1000, confidence: 'low' };
  }

  const estimated1RM = Math.round((mvt - intercept) / slope);

  // Confidence heuristic
  let confidence: 'high' | 'medium' | 'low';
  if (r2 >= 0.95 && n >= 3) {
    confidence = 'high';
  } else if (r2 >= 0.85 && n >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    estimated1RM: Math.max(0, estimated1RM),
    r2: Math.round(r2 * 1000) / 1000,
    confidence,
  };
}

// ─── Session Management ───

/**
 * Start a VBT tracking session.
 */
export function startVBTSession(exercise?: string): VBTSession {
  if (!connectedDevice) {
    // Create a placeholder device for manual/offline use
    const placeholder: VBTDevice = {
      name: 'Manual Entry',
      id: 'manual',
      type: 'generic',
      connected: false,
    };
    activeSession = {
      device: placeholder,
      readings: [],
      startTime: Date.now(),
      exercise,
    };
  } else {
    activeSession = {
      device: { ...connectedDevice },
      readings: [],
      startTime: Date.now(),
      exercise,
    };
  }
  return activeSession;
}

/**
 * End the current VBT session and return it.
 */
export function endVBTSession(): VBTSession | null {
  const session = activeSession;
  activeSession = null;
  return session;
}

/**
 * Get the active VBT session, if any.
 */
export function getActiveSession(): VBTSession | null {
  return activeSession;
}

// ─── UI Rendering ───

/**
 * Render a connect/disconnect button for VBT devices.
 */
export function renderVBTConnectButton(): string {
  if (!isBluetoothAvailable()) {
    return `<div class="vbt-unavailable">
      <span class="vbt-icon">&#x1F4F6;</span>
      <span>VBT sensors require Chrome, Edge, or Opera with Web Bluetooth support.</span>
    </div>`;
  }

  if (connectedDevice?.connected) {
    const battery = connectedDevice.batteryLevel != null
      ? ` &middot; ${connectedDevice.batteryLevel}%`
      : '';
    return `<div class="vbt-connected">
      <span class="vbt-status-dot connected"></span>
      <span class="vbt-device-name">${escapeHtml(connectedDevice.name)}</span>
      <span class="vbt-device-info">${escapeHtml(connectedDevice.type)}${battery}</span>
      <button class="btn btn-sm btn-outline vbt-disconnect-btn" data-action="vbt-disconnect">Disconnect</button>
    </div>`;
  }

  return `<div class="vbt-disconnected">
    <button class="btn btn-sm btn-primary vbt-connect-btn" data-action="vbt-connect">
      Connect VBT Sensor
    </button>
    <span class="vbt-hint">RepOne, GymAware, OpenBarbell, or generic BLE</span>
  </div>`;
}

/**
 * Wire up VBT connect/disconnect buttons using delegated event listeners (CSP-safe).
 * Call after inserting renderVBTConnectButton() HTML into the DOM.
 */
export function initVBTListeners(container: HTMLElement): void {
  container.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'vbt-connect') {
      connectVBTDevice().catch(() => { /* user cancelled or error */ });
    } else if (action === 'vbt-disconnect') {
      disconnectVBTDevice().catch(() => { /* already disconnected */ });
    }
  });
}

/**
 * Render real-time velocity feedback for a single rep.
 */
export function renderVelocityFeedback(reading: VelocityReading, exercise: string): string {
  const zone = classifyVelocityZone(reading.meanVelocity);
  const rpe = estimateRPEFromVelocity(reading.meanVelocity, exercise);
  const zoneClass = zone.zone.replace(/_/g, '-');

  return `<div class="vbt-velocity-feedback zone-${zoneClass}">
    <div class="vbt-velocity-main">
      <span class="vbt-mean-velocity">${reading.meanVelocity.toFixed(2)}</span>
      <span class="vbt-velocity-unit">m/s</span>
    </div>
    <div class="vbt-velocity-details">
      <span class="vbt-peak">Peak: ${reading.peakVelocity.toFixed(2)} m/s</span>
      ${reading.rom > 0 ? `<span class="vbt-rom">ROM: ${Math.round(reading.rom)} mm</span>` : ''}
      ${reading.duration > 0 ? `<span class="vbt-duration">${Math.round(reading.duration)} ms</span>` : ''}
      ${reading.power != null ? `<span class="vbt-power">${Math.round(reading.power)} W</span>` : ''}
    </div>
    <div class="vbt-zone-label">${zone.description}</div>
    <div class="vbt-rpe-estimate">Est. RPE ${rpe.toFixed(1)}</div>
  </div>`;
}

/**
 * Render a velocity loss indicator for the current set.
 */
export function renderVelocityLossIndicator(readings: VelocityReading[]): string {
  if (readings.length < 2) {
    return '<div class="vbt-velocity-loss">Need 2+ reps to track velocity loss</div>';
  }

  const result = detectVelocityLoss(readings);
  const lossClass = result.shouldStop ? 'loss-critical' : result.velocityLoss > 10 ? 'loss-warning' : 'loss-ok';

  return `<div class="vbt-velocity-loss ${lossClass}">
    <span class="vbt-loss-value">${result.velocityLoss.toFixed(1)}% velocity loss</span>
    <span class="vbt-loss-range">${result.firstRepVelocity.toFixed(2)} &rarr; ${result.lastRepVelocity.toFixed(2)} m/s</span>
    ${result.shouldStop
      ? `<span class="vbt-stop-warning">Stop set — &gt;20% velocity loss (${result.repsSinceThreshold} rep${result.repsSinceThreshold !== 1 ? 's' : ''} past threshold)</span>`
      : ''}
  </div>`;
}

/**
 * Render a simple load-velocity chart as an HTML table.
 * (Full charting would require a library; this gives a functional text view.)
 */
export function renderLoadVelocityChart(pairs: Array<{ weight: number; velocity: number }>): string {
  if (pairs.length === 0) {
    return '<div class="vbt-lv-chart-empty">No load-velocity data yet</div>';
  }

  const sorted = [...pairs].sort((a, b) => a.weight - b.weight);

  let rows = '';
  for (const p of sorted) {
    const barWidth = Math.min(100, Math.max(5, (p.velocity / 1.2) * 100));
    rows += `<tr>
      <td class="vbt-lv-weight">${p.weight}</td>
      <td class="vbt-lv-velocity">${p.velocity.toFixed(2)} m/s</td>
      <td class="vbt-lv-bar"><div class="vbt-lv-bar-fill" style="width:${barWidth.toFixed(0)}%"></div></td>
    </tr>`;
  }

  return `<table class="vbt-lv-chart">
    <thead><tr><th>Load</th><th>Velocity</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
