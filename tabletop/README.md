# Tabletop

A simple shared tabletop in the browser: a flat grid board with 3D minis on it.
One person is the GM and hosts the game; everyone else joins with a room code.

**Play:** https://xrunriot-wp.github.io/programs/tabletop/

## How it works

1. The GM opens the page, types a name and clicks **Create game**.
2. The GM clicks **Copy invite link** and sends it to the players.
3. Players open the link, type a name and click **Join**. Each player gets their own mini.

There are no accounts and no server: everyone's browser connects straight to the GM's browser.
The game is open while the GM's tab is open. If the GM refreshes, the same room code and board come back.

## Who can do what

| | Players | GM |
|---|---|---|
| Move minis | their own | all |
| Rename, recolour, resize (any size, e.g. 1x4), turn | their own | all |
| Attach pieces to each other (they move and turn together) | | yes |
| Paint terrain tiles (grass, stone, wood, water, lava, walls...) | | yes |
| Add / delete minis, give a mini to a player | | yes |
| Hide a mini from players | | yes |
| Board size, map picture, grid lines | | yes |
| 3D models (.glb) for minis | | yes |
| Physics dice (d4 to d100, "only me" rolls) and chat | yes | yes |

## Controls

- Drag a mini to move it (it snaps to the squares; turn **Snap to squares** off for free placement).
- Drag empty space to rotate the view, right-drag to pan, scroll to zoom.
- GM: select a mini and press **Delete** to remove it.

## Terrain

Pick a tile type under **Terrain** (or the **Eraser**) and painting turns on: click or drag across the board.
Tiles join up with their neighbours, and minis stand on top of them (walls too). **Fill board** covers every
square with the chosen tile, **Clear** removes all terrain. Turn **Paint** off to move minis again.

## Attaching pieces

Select a piece, click **Attach to…**, then click the piece it belongs on (a rider on a horse, a turret on a wagon).
When the main piece moves or turns, everything attached comes along. **Detach** separates them again.

## Dice

Dice are thrown onto the board from where you're looking and roll with real physics; the number that lands
on top counts (on a d4, the number at the top point). Everyone sees the same throw, and the result goes to the log.
A d100 is two d10s (tens and ones; 00 + 0 = 100). Untick **3D** for instant rolls.

## 3D models

Select a mini, then **Upload .glb**. The model is fitted onto the mini's base and sent to every player once,
so many minis can share one model. Keep models under about 5 MB so they load quickly (15 MB is the limit).
Blender, Sketchfab and most free mini packs can export .glb.

## Putting it on another website

It's three static files (`index.html`, `tabletop.js` and `dice.js`) with no build step. Copy them to any web host
(it needs https). Three.js, cannon-es (dice physics) and PeerJS load from unpkg.
