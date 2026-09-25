# Mists of Pandaria Classic port

This is a port of [chelinho139/wow-claude](https://github.com/chelinho139/wow-claude)
(MIT License, copyright (c) 2026 chelinho139 -- see [LICENSE](LICENSE)) from
WoW: Forever to **World of Warcraft: Mists of Pandaria Classic**. All credit
for the original design goes to chelinho139.

## What changed from the original

- The TOC interface is `50504`, and the capture process is `WowClassic`
  (see `bridge/config.example.json`).
- The game context sent to Claude has a MoP game label, your current
  specialization and your professions.
- Zygor directions: Claude's reply can include lines like
  `[[waypoint Zone 45.2,60.1 | label]]`, and the addon opens them as a
  Zygor Guides arrow (a hidden "Claude Directions" guide). See the primer's
  "Pointing the player somewhere" section. This needs Zygor installed, and
  so far it has only been tested against a stand-in Zygor, not in game.
- The bridge starts PowerShell by its full path, for PCs where
  `powershell.exe` isn't on PATH.

## Setup

Follow the original [README](README.md). When you copy
`bridge/config.example.json` to `bridge/config.json`, set `addonDir`,
`savedVariablesFile` and `inboxFile` to your own MoP Classic install and
account folder, and `defaultCwd` to the project folder Claude should work in.

Node 16 runs the bridge. Only the `node --test` suite needs Node 22+.
