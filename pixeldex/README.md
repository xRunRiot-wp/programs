# PixelDex

A Pokédex companion for Pixelmon Reforged (Minecraft 1.21.1; data from Pixelmon 9.4.1).

**Download:** the newest `pixeldex-v…` zip on the Releases page. Unzip it and double-click `PixelDex.vbs` — PixelDex opens in its own window. Portable: no .exe, nothing to install (its own Python is in the folder).

**Rebuild the data** (after a Pixelmon update): `python source/build.py --jar <path to Pixelmon jar> --out <folder>`.

```
PixelDex v2 - a Pokedex companion for Pixelmon Reforged (Minecraft 1.21.1)
==========================================================================

HOW TO START IT (portable - nothing to install)
1. Unzip the whole folder anywhere (Desktop, USB stick, ...).
2. Double-click  PixelDex.html  - it opens in your web browser.
   Chrome or Edge recommended (they can remember your world folder).
   Keep the "app" folder next to PixelDex.html.
There is no .exe and nothing runs in the background. To remove it, delete the folder.

TABS
- Pokedex: every Pokemon, grouped by region. Click one for:
    * its whole evolution family (earlier AND later evolutions), each marked
      "Caught" / "Not caught"
    * where to find it (wild spawns sorted by how common they are, structure
      spawns, and raids as separate sections)
    * every form and palette it has - click any of them to make that the picture
      shown for it in the Pokedex (the "Pictures" drop-down switches between your
      picks, the defaults, and all-shiny)
  A small blue "S" on a card = it only spawns inside structures.
- Forms: a Pokedex of every alternate form (regional, Mega, Gigantamax, other),
  with caught status per form.
- Palettes: a Pokedex of every palette (special colour variant). Use the drop-down
  to show one palette (e.g. Christmas, Zombie...), all of them, or shiny only, and
  sort by Pokedex number, palette name, Pokemon name, or not-caught-first.
- Browse by biome / structure: pick a biome OR a structure (Graveyard, Haunted
  Tower, temples, villages...) to see everything that spawns there.

LINKING YOUR CATCH DATA (optional)
Click the gear (top right) -> "Choose world save folder..." and pick your world's
save folder - the one named after your world, which has a "playerdata" folder in it:
  ...\Instances\<your modpack>\saves\<your world name>\
PixelDex only READS it. Caught status for species, forms and palettes then comes
straight from the game. Click "Sync" (top bar) after playing to refresh; in Chrome/Edge
it also refreshes on its own when you switch back to the window.
Single-player worlds (or servers you host) only. On someone else's server, use the
"Mark as caught" buttons instead (they're saved in your browser).

NOTES ON THE "% CHANCE" NUMBERS
Each Pokemon's share of the spawn-rarity pool for that biome, method and time of day,
from Pixelmon's own spawn data - a relative "how much more likely" guide, not an exact
in-game probability. "Any time" rows show the most conservative share. Raid Den numbers
assume every eligible Pokemon is equally likely. Structure spawns have no % (they're
extra spawns on top of the biome's normal ones).
```
