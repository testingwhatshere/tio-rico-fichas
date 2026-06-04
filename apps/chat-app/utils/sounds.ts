import { Audio } from 'expo-av';

let successSound: Audio.Sound | null = null;
let errorSound: Audio.Sound | null = null;
let loaded = false;

async function loadSounds() {
  if (loaded) return;
  loaded = true;

  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });

    const { sound: s } = await Audio.Sound.createAsync(
      require('@/assets/sounds/success.mp3'),
    );
    successSound = s;

    const { sound: e } = await Audio.Sound.createAsync(
      require('@/assets/sounds/error.mp3'),
    );
    errorSound = e;
  } catch (err) {
    console.warn('[Sounds] Failed to preload:', err);
  }
}

loadSounds();

export async function playSuccess() {
  try {
    if (!successSound) await loadSounds();
    if (successSound) {
      await successSound.setPositionAsync(0);
      await successSound.playAsync();
    }
  } catch (err) {
    console.warn('[Sounds] playSuccess failed:', err);
  }
}

export async function playError() {
  try {
    if (!errorSound) await loadSounds();
    if (errorSound) {
      await errorSound.setPositionAsync(0);
      await errorSound.playAsync();
    }
  } catch (err) {
    console.warn('[Sounds] playError failed:', err);
  }
}
