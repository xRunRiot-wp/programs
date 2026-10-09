PixelDex v{VERSION} - a Pokedex companion for Pixelmon Reforged (Minecraft 1.21.1)
============================================================================
The window's title bar says which version you are running ("PixelDex v{VERSION}").
Updating: delete the old PixelDex folder and unzip the new one. Your caught marks,
picture picks and world folder are kept in %APPDATA%\PixelDex\v2, so the new folder
picks them up by itself.


HOW TO START IT (portable - nothing to install, no .exe)
1. Unzip the whole folder anywhere (Desktop, USB stick, ...).
2. Double-click  PixelDex.vbs  - PixelDex opens in its own window, like before.
   (If your PC blocks .vbs files, double-click "Start PixelDex (backup).bat" instead.)
Everything it needs is inside the folder (its own copy of Python in "runtime").
To remove it, delete the folder (your settings stay in %APPDATA%\PixelDex\v2).
Uses Microsoft Edge WebView2, which comes with Windows 10/11.

TABS
- Pokedex: every Pokemon, grouped by region. Click one for:
    * what it evolves FROM (all the way back) and INTO (every later stage),
      plus the whole evolution family, each marked "Caught" / "Not caught"
    * where to find it: a table with Biomes, Time, Location, Weather, Conditions
      (height limits like "Min Y 100", light level, structures...), Level, Held
      item and Chance - click a biome group to see every biome with its %. Raids
      have their own table.
    * every form and palette it has - click any of them to make that the picture
      shown for it in the Pokedex (the "Pictures" drop-down switches between your
      picks, the defaults, and all-shiny). If your save shows you caught one as a
      shiny, the shiny picture is used automatically - unless you picked one.
  A small blue "S" on a card = it only spawns inside structures.
- Forms: a Pokedex of every alternate form (regional, Mega, Gigantamax, other),
  with caught status per form. Pokemon with a huge set of forms (Unown) are left out
  here - their own page still shows them all.
- Palettes: a Pokedex of every palette (special colour variant). Use the drop-down
  to show one palette (e.g. Christmas, Zombie...), all of them, or shiny only, and
  sort by Pokedex number, palette name, Pokemon name, or not-caught-first.
  Left out here because they have 60-130 palettes each: Alcremie, Gyarados,
  Magikarp (their own pages still show them all).
- Browse by biome / structure: pick a biome OR a structure (Graveyard, Haunted
  Tower, temples, villages...) to see everything that spawns there.

LINKING YOUR CATCH DATA (optional)
Click the gear (top right) -> "Choose world save folder..." and pick your world's
save folder - the one named after your world, which has a "playerdata" folder in it:
  ...\Instances\<your modpack>\saves\<your world name>\
PixelDex only READS it. Caught status for species, forms and palettes then comes
straight from the game. It refreshes on its own when you switch back to the window
(or click "Sync" in the top bar). If you used PixelDex v1, your world folder and
"Mark as caught" marks are picked up automatically.
Single-player worlds (or servers you host) only. On someone else's server, use the
"Mark as caught" buttons instead (PixelDex remembers them).

NOTES ON THE "% CHANCE" NUMBERS
Each Pokemon's share of the spawn-rarity pool for that biome, method and time of day,
from Pixelmon's own spawn data - a relative "how much more likely" guide, not an exact
in-game probability. "Any time" rows show the most conservative share. Raid Den numbers
assume every eligible Pokemon is equally likely. Structure spawns have no % (they're
extra spawns on top of the biome's normal ones).
