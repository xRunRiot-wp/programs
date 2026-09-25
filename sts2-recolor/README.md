# Spire Recolor (Slay the Spire 2 mod)

Recolor or repaint any character or boss in Slay the Spire 2, and share your look with friends. It's cosmetic only and never blocks multiplayer.

**Download:** the `sts2-recolor-v1` zip on the Releases page. It holds the ready-to-use `sts2_recolor` mod folder.

```
INSTALL
1. Open your Slay the Spire 2 folder (Steam > right-click the game > Manage > Browse local files).
2. Open (or create) the "mods" folder there.
3. Put the whole "sts2_recolor" folder from this zip inside "mods".
4. Start the game. If it asks about loading mods, say yes.

RECOLOR
- Press F8 anywhere in the game to open the editor (F8 again to close).
- Pick a character or boss, and optionally a single Part (helmet, sword, cloak...).
  "Show me" flashes the chosen part yellow on the preview.
- Sliders: hue / saturation / brightness / contrast / tint.
- Color swaps: "+ Add color swap", click a color on the preview, then choose its new color.

REPAINT A CHARACTER (custom model, characters only)
1. Pick a character, press "Export parts to edit". A folder opens with every body part as a PNG.
2. Edit or replace any of them in any paint program. Painting bigger than the original is fine
   (up to 4x) - keep the same shape, pose and transparent background.
3. Press "Reload my edits". Animations all keep working.
   Delete a PNG (or copy it back from _originals) to undo that part.
Note: this changes the combat model. The rest-site, shop and character-select versions of the
character use separate art and stay as they are.

SEE THE SAME THING AS A FRIEND
- Colors only: press "Copy share code", send the code; they press "Paste share code".
- Colors + repainted parts: press "Make share pack" and send the SpireRecolor_share_pack.zip it
  makes. Your friend puts that zip in mods/sts2_recolor/incoming/ and presses "Load share pack"
  (or just restarts the game - packs there load automatically).

It's cosmetic only and marked as not affecting gameplay, so it never blocks
multiplayer - even with friends who don't have it (they just see normal colors).
```

## Building from source

`src/` is a .NET 9 project. Set `GameDir` in `SpireRecolor.csproj` to your game's `data_sts2_windows_x86_64` folder, then run `dotnet build -c Release`. The game's own DLLs are referenced from your install, not included here.
