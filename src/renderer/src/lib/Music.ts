import { none, some } from "./rust-like-utils-client/Optional.js";
import { AudioSource, Optional, Song } from '../../../@types';
import { createDefaultSong, isSongUndefined, msToBPM } from './song';
import { createEffect, createSignal } from 'solid-js';
import { delay } from './delay';
import { createStore } from 'solid-js/store';



type ZeroToOne = number;



const player = new Audio();



const [media, setMedia] = createSignal<string>();



const [song, setSong] = createStore<Song>(createDefaultSong());
export { song }



const [duration, setDuration] = createSignal(0);
export { duration }



const [timestamp, setTimestamp] = createSignal(0);
export { timestamp }



const [volume, setVolume] = createSignal<ZeroToOne>(0.3);
export { volume, setVolume }
window.api.request("settings::get", "volume")
  .then(v => {
    if (v.isNone) {
      return;
    }

    setVolume(v.value);
  });



const [localVolume, setLocalVolume] = createSignal<ZeroToOne>(0.5);
export { localVolume, setLocalVolume }



function calculateVolume(): number {
  const v = volume();
  return v + ((localVolume() - 0.5) * 2 * v);
}
player.volume = calculateVolume();



const [bpm, setBPM] = createSignal<Optional<number>>(none(), {
  equals: (prev, next) => {
    if (prev.isNone && !next.isNone) {
      return true;
    }

    if (!prev.isNone && next.isNone) {
      return true;
    }

    if (!prev.isNone && !next.isNone) {
      return prev.value !== next.value;
    }

    return true;
  }
});
export { bpm }



const [isPlaying, setIsPlaying] = createSignal<boolean>(false);
export { isPlaying }



async function getCurrent(): Promise<{ song: Song, media: string } | undefined> {
  const song = await window.api.request("queue::current");

  if (song.isNone) {
    return;
  }

  const resource = await window.api.request("resource::getPath", song.value.audio);

  if (resource.isError) {
    return;
  }

  return {
    song: song.value,
    media: resource.value
  };
}

export async function play(): Promise<void> {
  if (media() === undefined) {
    const current = await getCurrent();

    if (current === undefined) {
      console.error("Cannot play current song");
      return;
    }

    setSong(current.song);
    setMedia(current.media);
  }

  const m = media();

  if (m !== undefined && player.src !== m) {
    player.src = m;
  }

  player.volume = calculateVolume();

  await player.play()
    .catch(reason => console.error(reason));

  setIsPlaying(true);
}

export function pause() {
  setIsPlaying(false);
  player.pause();
}

export async function next() {
  await window.api.request("queue::next");

  const current = await getCurrent();
  if (current === undefined) {
    console.error("Can't forward queue");
    return;
  }

  player.src = current.media;
  setMedia(current.media);

  if (isPlaying() === true) {
    await play();
  }

  setSong(current.song);
}

export async function previous() {
  await window.api.request("queue::previous");

  const current = await getCurrent();
  if (current === undefined) {
    console.error("Can't rollback queue");
    return;
  }

  player.src = current.media;
  setMedia(current.media);

  if (isPlaying() === true) {
    await play();
  }

  setSong(current.song);
}

export async function togglePlay(force?: boolean): Promise<void> {
  if (force !== undefined) {
    if (force === true) {
      await play();
      return;
    }

    pause();
    return;
  }

  if (isPlaying() === true) {
    pause();
    return;
  }

  await play();
}

export function seek(range: ZeroToOne): void {
  if (isNaN(player.duration)) {
    return;
  }

  player.currentTime = range * player.duration;

  setDuration(player.duration);
  setTimestamp(player.currentTime);
}



createEffect(async () => {
  setBPM(none());

  const audio = await window.api.request("resource::get", song.audio, "audio") as Optional<AudioSource>;

  if (audio.isNone) {
    return;
  }

  setLocalVolume(audio.value.volume ?? 0.5);
});



createEffect(() => {
  player.volume = calculateVolume();
});



const [writeVolume,] = delay(async (volume: number) => {
  await window.api.request("settings::write", "volume", volume);
}, 200);
createEffect(async () => {
  const v = volume();
  writeVolume(v);
});



createEffect(async () => {
  const lv = localVolume();

  if (isSongUndefined(song) || lv === 0.5) {
    return;
  }

  const audio = await window.api.request("resource::get", song.audio, "audio") as Optional<AudioSource>;

  if (!audio.isNone && audio.value.volume === lv) {
    return;
  }

  await window.api.request("save::localVolume", lv, song.path);
});



window.api.listen("queue::songChanged", async (s) => {
  const resource = await window.api.request("resource::getPath", s.audio);

  if (resource.isError) {
    return;
  }

  setMedia(resource.value);
  setSong(s);
  await play();
});



player.addEventListener("ended", async () => {
  await next();
});

const OFFSET = 0;
const BPM = 1;

player.addEventListener("timeupdate", () => {
  setTimestamp(player.currentTime);
  setDuration(player.duration);

  if (isSongUndefined(song) || song.bpm[0][OFFSET] / 1000 > player.currentTime) {
    return;
  }

  const bpmOpt = currentBPM(player.currentTime, song.bpm);
  const current = bpm();

  if (!bpmOpt.isNone && !current.isNone && bpmOpt.value !== current.value) {
    setBPM(some(bpmOpt.value));
  }
});



function currentBPM(offset: number, changes: number[][]): Optional<number> {
    if (changes.length === 0 || offset < changes[0][OFFSET] / 1000) {
        return none();
    }

    for (let i = 1; i < changes.length; i++) {
        if (changes[0][OFFSET] / 1000 <= offset && offset < changes[i][OFFSET] / 1000) {
            return some(msToBPM(changes[i - 1][BPM]));
        }
    }

  return some(msToBPM(changes[changes.length - 1][BPM]));
}
