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
| Move areas (burst, cone, line) and pings | their own | all |
| Stats on a mini (Dexterity, Alert, HP, statuses) | see their own | set them |
| Combat: roll initiative, next turn, end combat | end own turn, Dash | yes |
| Hide areas, dungeon event roll, rules settings | | yes |

## Player view (GM)

**Play as a test player** (under the room code) opens a second window where the GM is a real player
called "Test player" (with its own mini, starting with 1 in every stat): moving, End turn and Dash all work there, and it only sees what
players see. It's the same test player every time; delete its mini when you're done.

**Peek** switches the GM's own screen to a player's view: hidden minis,
hidden areas and everything on them, GM-only log lines and the GM menus disappear. **Looking as** picks a
player, so their own mini gets its white ring. **Back to GM view** returns. Nothing can be moved while looking.

## Controls

- Drag a mini to move it (it snaps to the squares; turn **Snap to squares** off for free placement).
- Right-click a mini to turn it.
- Right-drag to rotate the view, drag empty space to pan, scroll to zoom.
- **Phones and tablets:** drag a mini with your finger, hold a mini to turn it, tap someone else's mini (with yours
  picked) for line of sight, one finger pans, two fingers pinch to zoom and twist/drag to rotate. **Menu** opens the panel.
- GM: select a mini and press **Delete** to remove it.

## Dungeon play (PokéRole-style grid rules)

**Stats.** The GM picks a mini and fills in Dexterity, Alert, HP and Max HP, and adds statuses (Burn, Paralysis,
Immobilized, Slowed, Sped Up...). Players see their own mini's stats. The name tag shows an HP bar and the statuses.

**Movement range.** A picked mini with a Dexterity lights up the squares it can reach: 2 + Dexterity squares.
Minis can't stop on another mini's square, except that two **Small** minis may share one (they stand diagonally
across it, facing the same way).
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

**Status timers.** When the GM adds a status they can type how many **Rounds** it lasts. The countdown floats over
the mini's head (the status name with a gold number). It goes down by one at the end of each combat round, and
each party turn when exploring. At 0 the status wears off and the log says so. Leave Rounds empty for a status
that stays until the GM removes it.

**Move areas** (Mystery Dungeon move ranges). Under **Move areas & ping**, pick **Nearby (burst)**,
**Front + sides (cone)** or **Line**, set the size, click **Place**, then click the board. A burst is a square around
the clicked square. A cone or line starts from your picked mini (or from a first click) and points where you click
next: the shape follows the mouse first, in 45° steps. Everyone sees the squares in the placer's colour. Minis
inside get a pulsing ring, and the log says who was hit. Areas clear by themselves at the next combat turn or
party turn, or with × / **Clear** (players clear their own, the GM all of them).

**Ping.** Click **📍 Ping** and then a square, or Alt+click anywhere: rings and a beam with your name flash there
for everyone ("over here!"). A GM ping on a hidden area only shows to the GM.

**Random floors** (Mystery Dungeon style, GM: Combat tab > **Random floor**). Type a dungeon name, pick a look
(Cave, Forest, Ice, Ruins, Volcano, Beach cave) and size, how many enemies, chests, ? events and hidden traps, and
optionally the wild Pokémon that live there ("Golett, Zubat"). **Make floor** builds rooms joined by corridors on
the board picked in the Boards tab, with walls round them and darkness beyond. Everything on that board except the
players' minis is replaced; the team starts together in one room, the **Stairs** go in the room furthest away.
Enemy names that match a Pokémon on the Voice of the Forest site get its stats (and a built-in model if there is one).
A big banner shows the floor ("Golett Cave B1F") and a small tag stays at the top of the table.

**Stairs.** A player whose mini stands on the stairs gets a **Go to the next floor** button (in combat, on their
turn): the whole team goes down to a fresh floor of the same dungeon. The GM can also press **Next floor**, or paint
Stairs by hand (Terrain > Events). Hidden traps on a random floor look like ordinary floor to players.

**Player bar** (bottom middle of a player's screen, for their picked mini or their first one):
**⚔ Attack** (then click the target: the attack panel opens with the mini's own moves as buttons),
**💨 Dash** / Undo dash, **🎯 Actions** and **🎒 Bag**. In combat Attack, Dash and most actions wait for your turn.

**Attacks.** A miss plays the move and shows "Miss!" over the target. A hit waits for the damage roll; then the
move plays and the HP drops as it lands.

**Actions** (from the Voice of the Forest rules): Evade, Clash (physical / special), Grapple (a maneuver, Dexterity +
Clash), Search for cover, Run away, Hold, Help another, and the quick explore / talk rolls (Search, Climb, Carry,
Sneak, Keep watch, Navigate, Persuade, Comfort, Respectful talk, Inspire, Distract, Command, Deceive). Each rolls the
mini's attribute + skill as a dice pool (4-6 = a success, pain penalties apply) and writes the result in the log; the
GM decides what it does. Evade and Clash can be used outside your turn.

**Bag.** One shared team bag: anyone can add items (with the usual Mystery Dungeon items suggested), take one out,
or press **Use** for their mini: the log says who used what (and what the item usually does); the GM applies it.

**3D models from Sketchfab.** Download the model as **glTF Binary (.glb)** and use **Upload .glb** on the mini. Older
Sketchfab files with "specular-glossiness" materials (which three.js no longer reads) are converted automatically.

**Line of sight.** Pick a mini and point at another: a green rod means in sight, red means blocked
(walls, thin walls, hedges, doors and trees block the view), with the distance in squares.

**Exploring = party turns.** Out of combat, all allies move and act in the same turn, each up to their range
(and once each: **Dash** / **Undo dash**). When everyone is done the GM clicks **Next party turn**.

**? markers.** The GM places **? Event** markers (Terrain > Events). A ? sits on its square like an object. When an
ally stands next to it (sides or corners), an **Interact** button appears over it; clicking it is free (not an action;
in combat only on that mini's turn). The marker disappears and the GM gets **Throw the event d6**: a physics d6
only the GM sees (1 trap or hazard, 2 enemy team, 3 treasure, 4 guild challenge, 5 safe passage, 6 mission clue).
The **event card** then shows that event's rules with helper rolls: direction (2d6) + distance (1d6, reroll 5-6) for
treasure and clues, loot rarity (2d6 + floor modifier), the Threat Counter and Start combat for enemy teams, and
**Tell the players** to announce it.

**Event pieces** (Terrain > Events), one for each dungeon event:
- **Hidden trap** (players can't see it; the GM sees a faint red cross). An ally stepping on it sets it off: it
  turns into a visible **Trap** (spike plate) and the GM gets the Trap or Hazard card.
- **Enemy camp** (tent and banner), **Guild flag**, **Campfire** (safe passage) as markers.
- **Treasure chest**: an ally next to it clicks **Open chest**; it opens and the GM rolls the loot (2d6 + floor modifier).
- **Clue** (!): **Check clue**; the GM rolls where the next clue is, or says it leads to the goal.
- **Dungeon goal** (glowing crystal, ★): reaching it lets the GM announce the mission complete.
While an event waits for the GM (the die not thrown yet, or its card still open) the game is **paused**: players
can't move, End turn or Dash until the GM clicks **Done** on the card. A big **🎲 Throw the event d6** button
appears over the table for the GM, and the event card then shows in the same spot.
Each event card also has a **Place ...** button that picks the matching piece so the GM can click it onto the board.

**Hidden areas.** Each board is one dungeon area. **+ Add hidden area** makes a board the players can't see
(nor anything on it). Players can never walk onto a square they can't see: an area is revealed when an ally stands
right next to one of its open squares (not diagonally, and not through a wall). **Wall the edges** rings the picked board
with walls; paint a **Door** (or erase a wall) on one edge square and that's the room's only way in, so a 7x7 room
can have a one-square entrance. The GM can also **Roll dungeon event** by hand.

**Attacks.** Pick your mini, click **⚔ Attack…**, then click the mini to attack. Your mini turns to face it.
Pick a move (the list is read live from the Voice of the Forest site; nothing is ever changed there) and check the
numbers: accuracy = the move's attribute + skill dice, a hit needs 1 success; damage = attribute + the move's Power
minus the target's Vitality (or Insight against Special moves). The dice land green on 4-6 (a success) and red on 1-3,
and the badge counts the successes. On a hit, **Roll damage** takes that many HP off the target. Her combat rules are applied: same-type moves get
+1 damage die, 4+ accuracy successes are a critical (+2 damage dice), super effective +1 damage per weak type (not very
effective -1, immune = none), pain at half HP / 1 HP removes 1 / 2 successes, and a move's Chance Dice are rolled after
it lands (any 6 triggers the effect, written in the log for the GM). Physical moves lunge and
claw, Special moves throw an orb, Status moves ring the target, all in the move's type colour. The numbers you type are
remembered on the mini; only the GM can set the target's defence.

**Pokémon.** The GM can type a Pokémon into a mini's **Pokémon** box: its attributes, HP (base HP + Vitality),
types and moves are filled in from the site, and its moves come first in the attack list.

**Warp out.** When the GM marks a Dungeon Goal **Mission complete!**, every player gets a vote to warp out. Only a
unanimous yes warps the team out; one "Stay" and the chance is gone (one per goal).

**Working on minis in secret.** Tick **Hidden from players while I work on it** before adding a mini. **Save to list**
keeps a copy of any mini in the GM's **Saved minis** list (players never see it); **Place** puts a hidden copy on the table.
Saved minis go in the labelled group typed above the list (e.g. "Floor 1 enemies"); **✎** renames one or moves it to
another group. Click a group's name to open or close it.

**The GM's panel** is split into tabs: **Minis**, **Combat** (players, dice and log on top, then exploring, combat and rules), **Terrain** and **Boards**.
Players see the plain panel as before.

**Saved boards** (Boards tab): give the picked board a name and a group and click **Save picked board**. It keeps the
board's size, grid, map picture, terrain and the GM's minis on it. **Place** puts a copy on the table to the right of the
other boards; **Hidden** places it as a hidden area for the players to find.

## Boards

The table can have several boards, each with its own size, map picture and grid. **+ Add board** puts a new one
next to the others. Turn on **Move boards** and drag a board: it snaps to whole squares, so boards join edge to edge,
and the minis and terrain on it move along. Minis can walk from one board onto the next.
**Edge walls** (Rules & Dungeon, on by default): every board has a low wall all round its edge. Where two boards
join, the wall has a one-square gap at the middle of the shared edge: the only way through. These walls block
movement and line of sight like real walls, and a hidden area is revealed only through its gap.
Revealing an area locks in the movement spent so far that turn: the rest of the move is counted from where the
mini stands, with what's left, so walking back can't give it extra movement.
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
When the main piece moves or turns, everything attached comes along, and attached minis all move at the slowest one's speed
(minis with 0 movement, or with no speed set, don't count). **Detach** separates them again.

## Dice

Dice are thrown onto the board from where you're looking and roll with real physics; the number that lands
on top counts (on a d4, the number at the top point). Everyone sees the same throw, and the result goes to the log.
A d100 is two d10s (tens and ones; 00 + 0 = 100). Untick **3D** for instant rolls.

## 3D models

Select a mini, then **Upload .glb**. The model is fitted onto the mini's base and sent to every player once,
so many minis can share one model. Keep models under about 5 MB so they load quickly (15 MB is the limit).
Blender, Sketchfab and most free mini packs can export .glb.

Built-in models come with the site and show up in the same **3D model** list: right now **Golett**.
A mini linked to a Golett on the Voice of the Forest site gets the Golett model by itself (if it has no model yet).

Credits: the Golett model is ["Golett"](https://sketchfab.com/3d-models/golett-0d239c883bc54a4f94a3e15ac789e378) by nguyenlouis32,
licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (material converted to standard glTF, otherwise unchanged).

## Putting it on another website

It's four static files (`index.html`, `tabletop.js`, `dice.js` and `rules.js`) with no build step. Copy them to any web host
(it needs https). Three.js, cannon-es (dice physics) and PeerJS load from unpkg.
