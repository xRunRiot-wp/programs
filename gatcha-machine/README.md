# Gatcha Machine

A Pixelmon add-on mod: earn points and spend them on a case-opening spin that spawns a boss Pokemon.

**For:** Minecraft 1.21.1, NeoForge, Pixelmon 1.21.1-9.4.1 (or newer 9.4.x). Singleplayer or LAN.

## Install
1. Download `gatchamachine-1.2.0.jar` from the release `gatcha-machine-v1.2`.
2. Put it in your instance's `mods` folder, next to the Pixelmon jar.
3. On LAN, everyone joining needs it too.

## How it works
- **Craft the Gatcha Machine:** glass across the top, glass / Poke Ball / glass in the middle, iron ingot / gold ingot / iron ingot on the bottom.
- Having it in your inventory earns the **Insert Coin** achievement. Your points only start counting after that.
- **Points:** +5 every 5 seconds. For a new Pokedex entry: +200 for a new Pokemon, +100 for a new palette, +50 for a new form (one reward per entry, whichever is biggest).
- **Shinies:** +500 for every shiny you catch or hatch from an egg, even repeats of a species. Stacks with the Pokedex reward.
- **Right-click the machine** to open it. Pick a tab and press **Open**:
  - Rare 2250, Epic 4500, Legendary 6750, Ultimate 9000.
  - Ultimates are always a Mega or Primal form.
  - **Never encountered only** (Ultimate tab): picks a Mega/Primal you've never seen in your Pokedex. It costs +0% when you've seen none, rising to almost +100% for the last one left.
- The reel spins and stops on your boss, which then appears a few blocks in front of you. Its level is your strongest party Pokemon plus the tier's bonus levels, capped at 100.

## Your points are safe across updates
Points are saved with your player in the world save, not inside the mod. "Never encountered" reads Pixelmon's own Pokedex, so updating this mod keeps both.
