// Web implementation using HTML5 Audio API

let successAudio: HTMLAudioElement | null = null;
let errorAudio: HTMLAudioElement | null = null;

function preload() {
  try {
    // Metro bundler resolves require() to a URI for web assets
    successAudio = new Audio(require('@/assets/sounds/success.mp3'));
    successAudio.preload = 'auto';
    errorAudio = new Audio(require('@/assets/sounds/error.mp3'));
    errorAudio.preload = 'auto';
  } catch (err) {
    console.warn('[Sounds.web] Failed to preload:', err);
  }
}

preload();

export async function playSuccess() {
  try {
    if (!successAudio) preload();
    if (successAudio) {
      successAudio.currentTime = 0;
      await successAudio.play();
    }
  } catch (err) {
    // Browser may block autoplay before user interaction — ignore silently
    console.warn('[Sounds.web] playSuccess failed:', err);
  }
}

export async function playError() {
  try {
    if (!errorAudio) preload();
    if (errorAudio) {
      errorAudio.currentTime = 0;
      await errorAudio.play();
    }
  } catch (err) {
    console.warn('[Sounds.web] playError failed:', err);
  }
}
