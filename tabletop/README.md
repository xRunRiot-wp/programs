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
| Rename, recolour, turn | their own | all |
| Resize (any size, e.g. 1x4) | | yes |
| Attach pieces to each other (they move and turn together) | | yes |
| Paint terrain tiles (grass, stone, wood, water, lava, walls...) | | yes |
| Add / delete minis, give a mini to a player | | yes |
| Hide a mini from players | | yes |
| Boards: add more, size, map picture, grid lines, drag them together | | yes |
| 3D models (.glb) for minis | | yes |
| Physics dice (d4 to d100, "only me" rolls) and chat | yes | yes |
| Stats on a mini (Dexterity, Alert, HP, statuses) | see their own | set them |
| Combat: roll initiative, next turn, end combat | end own turn, Dash | yes |
| Hide areas, dungeon event roll, rules settings | | yes |

## Player view (GM)

**Play as a test player** (under the room code) opens a second window where the GM is a real player
called "Test player" (with its own mini): moving, End turn and Dash all work there, and it only sees what
players see. It's the same test player every time; delete its mini when you're done.

**Peek** switches the GM's own screen to a player's view: hidden minis,
hidden areas and everything on them, GM-only log lines and the GM menus disappear. **Looking as** picks a
player, so their own mini gets its white ring. **Back to GM view** returns. Nothing can be moved while looking.

## Controls

- Drag a mini to move it (it snaps to the squares; turn **Snap to squares** off for free placement).
- Right-click a mini to turn it.
- Right-drag to rotate the view, drag empty space to pan, scroll to zoom.
- GM: select a mini and press **Delete** to remove it.

## Dungeon play (PokéRole-style grid rules)

**Stats.** The GM picks a mini and fills in Dexterity, Alert, HP and Max HP, and adds statuses (Burn, Paralysis,
Immobilized, Slowed, Sped Up...). Players see their own mini's stats. The name tag shows an HP bar and the statuses.

**Movement range.** A picked mini with a Dexterity lights up the squares it can reach: 2 + Dexterity squares.
Difficult ground (swamp, water, river, snow) costs 2 per square; walls, hedges, fences, rocks, trees and pits
block; you can't slip diagonally past a wall corner; you can pass other minis but not stop on them.
Immobilized means 0. A diagonal step counts as 1 square.

**Combat.** The GM clicks **Start combat**: every player's mini and every GM mini with a Dexterity rolls
initiative (1d6 + Dexterity + Alert; missing stats count as 0). Anyone joining mid-fight rolls and slots in; the GM
can also **Add to / Take out of turn order** on a picked mini;
Sped Up goes first and Slowed last. The **Turn order** list and a gold marker show whose turn it is.
On your turn: move, take your action, **End turn**. **Dash** spends your action on another move's
worth of squares (once a turn); press it again to take it back if you haven't gone past a normal move.
When the order comes round again the log reminds everyone that Burn, Poison and weather happen.
With **Limit moves in combat** (on unless the GM turns it off) a player can only move on their own turn and
only within range; a move that's too far snaps back.

**Engaged** shows on the name tags when a player's mini stands next to a GM mini.

**Line of sight.** Pick a mini and point at another: a green rod means in sight, red means blocked
(walls, thin walls, hedges, doors and trees block the view), with the distance in squares.

**Exploring.** Each board is one dungeon area. **+ Add hidden area** makes a board the players can't see
(nor anything on it). When a player steps onto it, it's revealed. Every 2 new areas the GM is reminded
to **Roll dungeon event** (1d6: trap or hazard, enemy team, treasure, guild challenge, safe passage,
mission clue); only the GM sees that roll.

## Boards

The table can have several boards, each with its own size, map picture and grid. **+ Add board** puts a new one
next to the others. Turn on **Move boards** and drag a board: it snaps to whole squares, so boards join edge to edge,
and the minis and terrain on it move along. Minis can walk from one board onto the next.
Click a board's name to pick it for editing (it gets an outline).

## Terrain

Floors (grass, stone, cobble, wood, dirt, sand, snow, ice, swamp, carpet, checker, water, lava, pit), walls
(wall block, low block, thin wall, hedge, door, fence), paths (road, river, bridge) and props (tree, rock).
Thin walls, hedges, doors and fences join up with their neighbours; doors line up with the wall they're in;
roads and rivers run on into the next road or river square; a bridge sits across a river.

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

It's four static files (`index.html`, `tabletop.js`, `dice.js` and `rules.js`) with no build step. Copy them to any web host
(it needs https). Three.js, cannon-es (dice physics) and PeerJS load from unpkg.
