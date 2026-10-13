# Biome Compass

A Nature's Compass-style biome finder, except biomes start locked: you have to visit a biome before the compass can find it.

**For:** Minecraft 1.21.1, NeoForge. Singleplayer or LAN. Curios is optional (adds a Compass slot).

## Install
1. Download `biomecompass-1.1.0.jar` from the release `biome-compass-v1.1`.
2. Put it in your instance's `mods` folder.
3. On LAN, everyone joining needs it too.

## How it works
- **Craft it:** saplings in the corners, logs on the sides, a compass in the middle (any sapling or log).
- **Unlocking:** stand in a biome for 10 seconds and it's unlocked ("Biome unlocked: Cherry Grove" in chat). Cave biomes count too.
- **Right-click** to open the list of unlocked biomes for the dimension you're in. Type to filter, click a biome, press **Search** (or click it twice).
- The search runs in the background without lagging the game. When it's found, the needle points there and the top-left of the screen shows the biome, coordinates and distance. Search radius: 10,000 blocks.
- **Find Next:** skips the patch you're pointed at (the whole connected area of that biome) and finds the next-nearest one. Press it again to keep stepping further out.
- **Stop Tracking** clears the biome the compass is tracking.
- **Teleport** button for players with cheats/op.
- Its own look: wooden rim, parchment face and a leaf needle.

## Compass groups
- Everyone has their own unlocked biomes.
- Press **Group** in the compass screen and **Invite** an online player. They click **[Accept]** in chat.
- Everyone in a group sees every biome any member has found, including ones found before they joined.
- **Leave Group** takes you out. You keep only the biomes you found yourself.

## Curios
With Curios installed there's a **Compass** slot that only takes the Biome Compass. While it's in there:
- the distance text still shows on screen
- a small compass button appears in the top-right corner of your inventory to open the biome list. It sits inside the inventory frame, so it doesn't cover JEI or the recipe book button.

## Saves
Unlocks and groups are saved in the world (`data/biomecompass.dat`), so updating the mod keeps them.
