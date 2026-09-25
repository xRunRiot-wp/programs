# PixelDex

A Pokedex companion for Pixelmon Reforged (1.21.1, tested against 9.3.16).

**Download:** the `pixeldex-v1` zip on the Releases page. Unzip it and double-click `PixelDex.exe`; there's nothing to install. Only the built program is published here.

```
PixelDex - a Pokedex companion for Pixelmon Reforged (1.21.1, tested against 9.3.16)
=====================================================================================

WHAT THIS IS
Browse every Pokemon, see which biomes/methods to catch them in (sorted by how
common they are), browse a specific biome to see everything that spawns there,
and track what you've caught.

HOW TO RUN
Double-click PixelDex.exe. It opens its own window - nothing to install.
(Windows SmartScreen may warn about an unrecognized app the first time; click
"More info" -> "Run anyway". This happens because the app isn't code-signed,
not because anything is wrong with it.)

TWO VIEWS
- "Pokedex" tab: browse/search all Pokemon, grouped by region (Kanto, Johto,
  etc). Click one to see where to find it - wild spawns and Raid Den / Mega
  Raid encounters are shown as separate sections, since they work completely
  differently in-game. If it evolves from something, that's shown top-right
  with a clickable icon.
- "Browse by biome" tab: pick a biome and see every Pokemon that can spawn
  there, sorted most-common-first, with legendary encounters pulled to the
  top automatically, a day/night filter, a wild-vs-raid filter, and a "hide
  already caught" checkbox.

LINKING UP YOUR CATCH DATA (optional but recommended)
Click the gear icon (top right) -> "Choose world save folder...".
Point it at your Minecraft world's SAVE folder - the one named after your
world, which contains a folder called "playerdata" inside it. For example:
  ...\Instances\<your modpack>\saves\<your world name>\

Once selected, PixelDex reads your game's own Pokedex data directly, so
caught/seen status stays in sync automatically - just hit reload/reopen the
app after playing to see updates.

This only works for a SINGLE-PLAYER world (or a server you host yourself and
have file access to). If you play on someone else's multiplayer server, that
data lives on their machine and PixelDex can't reach it - in that case just
click "Mark as caught" manually on each Pokemon's detail popup instead.

NOTES ON THE "% CHANCE" NUMBERS
These are each Pokemon's share of the spawn-rarity pool for that specific
biome, encounter method, and time of day, calculated from Pixelmon's own
spawn data - a solid relative "how much more likely is X than Y" guide, not
an exact in-game probability (the game also factors in spawn caps, chunk
density, etc. that aren't in the static files). A row shown as "Any time"
means the spawn isn't day/night restricted; its percentage is the most
conservative (lowest) of that Pokemon's hourly shares, so it won't overstate
how common it is. Raid Den percentages assume every eligible Pokemon is
equally likely (Pixelmon doesn't expose real weighting for raid picks).
Extremely rare spawns (well under 0.1%) are left off the list entirely
rather than shown as a confusing "0%".

UPDATING FOR A NEWER PIXELMON VERSION
The Pokemon/spawn data is baked in from a specific Pixelmon jar version. If
you update Pixelmon and want fresh data, this needs to be rebuilt from
source (ask whoever gave you this app).
```
