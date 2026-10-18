# Forage Station

A Pixelmon add-on: put a Pokémon into a Forage Station and it forages the biome on its own.

**For:** Minecraft 1.21.1, NeoForge, Pixelmon 9.4.1 or newer. Singleplayer or LAN.

## Install
1. Download `foragestation-1.0.0.jar` from the release `forage-station-v1`.
2. Put it in your instance's `mods` folder.
3. On LAN, everyone joining needs it too.

## How it works
- **Craft it:** wheat, chest, wheat on top; log, Poké Ball, log in the middle; three logs on the bottom.
- **Place it and right-click it.** A picker opens with your **party** and every **PC box** (use **<** and **>** to flip pages). Hover a Pokémon to see its level, Speed and how often it will forage. Click one to send it in.
- The Pokémon leaves your party/PC, and its picture floats above the station.
- **It forages by itself** using Pixelmon's own Forage item list. That means the same biome loot (berries, apricorns, evolution stone shards, seeds and so on), the same time-of-day and open-sky rules, and the same `forage-chance` setting from `external_moves.yml`. Pokémon encounters from Forage are left out, so nothing attacks the station.
- **Speed decides how often:** a try every 25 seconds at 0 Speed, down to every 12.5 seconds at 200 Speed or more.
- **Right-click** the station to open its storage (27 slots). The title shows the Pokémon and when the next find is due. A hopper underneath pulls the finds out. When it's full, foraging pauses.
- **Shift + right-click with an empty hand** to take the Pokémon back. It goes back where it came from: your party (if there's room) or your PC.
- **If the station is broken** (by anyone, or an explosion), its Pokémon goes back to the owner's PC and the stored items drop. If the owner is offline, the Pokémon waits and arrives in their PC when they next log in.
- Only the player who placed the station can put in or take out its Pokémon. You can't send away your last party Pokémon. Eggs can't forage.
- The station only works while its chunk is loaded, like a furnace.
