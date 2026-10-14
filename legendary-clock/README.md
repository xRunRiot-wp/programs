# Legendary Clock

A Pixelmon add-on: a clock that tells you when the next legendary and mega boss spawn will be tried, and what time of day it will be then.

**For:** Minecraft 1.21.1, NeoForge, Pixelmon 9.4.1 or newer. Singleplayer or LAN. Curios is optional (adds a Clock slot).

## Install
1. Download `legendaryclock-1.1.0.jar` from the release `legendary-clock-v1.1`.
2. Put it in your instance's `mods` folder.
3. On LAN, everyone joining needs it too.

## How it works
- **Craft it:** gold ingots in the corners, amethyst shards on the sides, a clock in the middle.
- **Right-click** it (or press the clock button in your inventory) to open the clock screen:
  - **Legendary Pokémon:** time until Pixelmon's next legendary spawn try, the time of day it will be at that moment (for example "Night + Midnight" when both apply), and the chance that try spawns one.
  - **Mega Boss:** the same for the mega boss spawner.
  - **Right now:** the time of day at the moment.
- The times of day are Pixelmon's own: Dawn, Morning, Day, Midday, Afternoon, Dusk, Night, Midnight. They overlap, so you'll often see two or three at once. These are what decide which legendaries can spawn.
- When the timer reaches zero it shows "Any moment": Pixelmon picks a random player and rolls the chance at its next check.
- The timer counts real time, the same way Pixelmon does. If the daylight cycle is off, the screen says so and the time of day won't change.

## On-screen timer
- While you carry the clock (hand, inventory or Curios slot), a small timer shows on screen: one line for the legendary, one for the mega boss.
- **Timer on screen: ON/OFF** in the clock screen hides or shows it.
- **Timer size** slider: 50% to 300% in 25% steps.
- **Show when under** slider: Always, or only once a timer is 1, 2, 3, 5, 10, 15, 20, 30, 45 or 60 minutes or less from its try. Each line (legendary, mega boss) appears on its own once it's within that time; until then the timer stays hidden.
- **Move Timer** lets you drag it anywhere (scroll the mouse wheel to resize it there too), then **Done**. **Reset** puts it back under the top-left corner at normal size. Settings are saved per computer (`config/legendaryclock-client.json`).

## Curios
With Curios installed there's a **Clock** slot that only takes the Legendary Clock. The inventory button sits under the crafting result, inside the inventory frame, so it doesn't cover JEI, the recipe book or the Biome Compass button.
