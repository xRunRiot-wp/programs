# Damage Meter (Slay the Spire 2 mod)

A Details!-style damage meter for Slay the Spire 2, like the classic World of Warcraft addon. It's cosmetic only and never blocks multiplayer.

**Download:** the `sts2-damage-meter-v1` zip on the Releases page. It holds the ready-to-use `STS2_DamageCharts` mod folder.

```
INSTALL
1. Open your Slay the Spire 2 folder (Steam > right-click the game > Manage > Browse local files).
2. Open (or create) the "mods" folder there.
3. Put the whole "STS2_DamageCharts" folder from this zip inside "mods".
4. Start the game. If it asks about loading mods, say yes.

THE METER
- A ranked bar list (icon, bar, "total (per turn, %)") appears in combat. Hover a bar for a breakdown.
- Drag it from anywhere; resize it (width + number of rows) from the bottom-right corner.
  Position and size are remembered.
- Modes: Damage Done, DPS per turn, Damage Taken, Damage Blocked, Differential (dealt vs taken),
  Doom & Poison, and Enemy Debuffs.
- Poison and Doom get their own rows (and their own colors on the bars).
- In combat you can flip between this fight and the whole run; between fights it shows the whole run.
- After each fight a summary window pops up (draggable), with a tab per player.
- Press C for the full-screen breakdown (by card, power, relic, with the combat log).
  Pressed outside combat it shows the whole-run recap.

CO-OP
- Each player gets a row with their Steam name and character icon, in their character's color.
- Poison and Doom are credited to whoever applied them; relic damage to the relic's owner.
- It's marked as not affecting gameplay, so friends without the mod can still play with you.
```

## Credits

A fork of [brian-gates/sts2-damage-charts](https://github.com/brian-gates/sts2-damage-charts) (MIT license, see `LICENSE`). The original project's README is kept as `src/UPSTREAM-README.md`.

Changes in this fork:
- The meter UI (Details!-style bars, modes, tooltips, resize, post-fight summary, run stats).
- Doom & Poison tracking and multiplayer crediting.
- A fix for the game's newer 7-parameter damage function, which the original hook no longer matched.

## Building from source

You need Slay the Spire 2 installed and the .NET 9 SDK.

```
cd src
dotnet build STS2_DamageCharts.csproj -c Release -o out -p:STS2GameDir="<your Slay the Spire 2 folder>"
```

Then copy `out/STS2_DamageCharts.dll` and `mod_manifest.json` (renamed `STS2_DamageCharts.json`) into `mods/STS2_DamageCharts/`.
