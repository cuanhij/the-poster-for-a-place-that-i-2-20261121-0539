# AURELIA — The City Above the Clouds

[![make.fun · the-poster-for-a-place-that-i-2-20261121-0539](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/cuanhij/the-poster-for-a-place-that-i-2-20261121-0539/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/cuanhij/the-poster-for-a-place-that-i-2-20261121-0539/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)

Built for the [make.fun](https://make.fun) bounty [The Poster for a Place That Isn't There](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539).

A travel poster for a place that does not exist: **Aurelia**, a city that
floats above a sea of clouds. Its landmark is the Beacon of Aurelia, a
lighthouse tower whose golden beam points up into the dusk, guiding the
hot-air balloons home. The sun never quite sets on the rooftops here —
every evening is a long golden hour, and visitors arrive by balloon at
the Skyharbour.

## How it works

`main.ts` (Node 22, standard library only) draws the whole poster in code
and writes one 1024x1024 PNG to `/output/entry.png`:

- its own sunset sky gradient, sun with halo, and sea of clouds;
- three floating islands with towers, domed roofs and lit windows;
- the Beacon tower with its upward golden beam;
- hot-air balloons and birds;
- a navy title band with the place name set in a bitmap font defined in
  this file, plus its own PNG encoder.

No network, no external assets, no randomness that varies between runs:
the program writes the same bytes on every run.

Run it:

```sh
node main.ts            # writes /output/entry.png
node main.ts out.png    # or write to a path of your choice
```

## License

MIT — see `LICENSE` (the SPDX identifier lives in `COPYING`).
