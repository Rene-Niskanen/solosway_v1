/**
 * Plays a short, subtle sound when Velora finishes a response.
 * Uses Web Audio API so no asset is required and it works in all environments.
 * Respects the user preference stored in localStorage (see NOTIFICATION_SOUND_STORAGE_KEY).
 */

export const NOTIFICATION_SOUND_STORAGE_KEY = 'velora_completion_sound_enabled';
export const NOTIFICATION_SOUND_VOLUME_KEY = 'velora_completion_sound_volume';

export type CompletionSoundOption = 'off' | 'chime' | 'soft' | 'bright' | 'bell' | 'blip' | 'ding' | 'ascending';

const VALID_OPTIONS: CompletionSoundOption[] = ['off', 'chime', 'soft', 'bright', 'bell', 'blip', 'ding', 'ascending'];

function getStoredSoundOption(): CompletionSoundOption {
  if (typeof window === 'undefined') return 'chime';
  const stored = window.localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY);
  if (stored === null) return 'chime';
  if (stored === 'true' || stored === 'on' || stored === 'chime') return 'chime';
  if (stored === 'false' || stored === 'off') return 'off';
  if (stored === 'subtle') return 'chime'; // removed option, fallback to chime
  if (VALID_OPTIONS.includes(stored as CompletionSoundOption)) return stored as CompletionSoundOption;
  return 'chime';
}

/** Volume 0–100. Default 80. */
export function getStoredSoundVolume(): number {
  if (typeof window === 'undefined') return 80;
  const stored = window.localStorage.getItem(NOTIFICATION_SOUND_VOLUME_KEY);
  if (stored === null) return 80;
  const n = Number(stored);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 80;
}

function isCompletionSoundEnabled(): boolean {
  return getStoredSoundOption() !== 'off';
}

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioContext;
}

/**
 * Play a short two-note completion chime when the AI response is done.
 * Safe to call multiple times; uses a low volume and short duration.
 */
function playTone(
  ctx: AudioContext,
  gainNode: GainNode,
  frequency: number,
  startTime: number,
  duration: number
): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, startTime);
  osc.connect(gainNode);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function playCompletionSound(): void {
  if (!isCompletionSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const option = getStoredSoundOption();
  const volumePct = getStoredSoundVolume();
  const volumeMultiplier = volumePct / 100;
  const t0 = ctx.currentTime;

  const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
  resume.then(() => {
    try {
      const gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);

      // At 100% volume, peak gain is ~0.4 so sounds are clearly audible
      if (option === 'chime') {
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(0.4 * volumeMultiplier, t0 + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
        playTone(ctx, gainNode, 880, t0, 0.18);
      } else if (option === 'soft') {
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(0.35 * volumeMultiplier, t0 + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
        playTone(ctx, gainNode, 659.25, t0, 0.25);
      } else if (option === 'bright') {
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(0.35 * volumeMultiplier, t0 + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
        playTone(ctx, gainNode, 523.25, t0, 0.1);
        playTone(ctx, gainNode, 659.25, t0 + 0.08, 0.12);
        playTone(ctx, gainNode, 783.99, t0 + 0.16, 0.14);
      } else if (option === 'bell') {
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(0.38 * volumeMultiplier, t0 + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
        playTone(ctx, gainNode, 1046.5, t0, 0.35);
      } else if (option === 'blip') {
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(0.35 * volumeMultiplier, t0 + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
        playTone(ctx, gainNode, 1318.51, t0, 0.1);
      } else if (option === 'ding') {
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(0.4 * volumeMultiplier, t0 + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
        playTone(ctx, gainNode, 587.33, t0, 0.22);
      } else if (option === 'ascending') {
        gainNode.gain.setValueAtTime(0, t0);
        gainNode.gain.linearRampToValueAtTime(0.32 * volumeMultiplier, t0 + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
        const freqs = [523.25, 659.25, 783.99, 1046.5];
        freqs.forEach((f, i) => playTone(ctx, gainNode, f, t0 + i * 0.08, 0.2));
      }
    } catch {
      // Ignore errors (e.g. autoplay policy)
    }
  }).catch(() => {});
}
