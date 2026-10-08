# Schedule Helper (HotSchedules to Kronos)

A Chrome extension that takes the **Weekly Roster** export from HotSchedules and helps you
enter the same shifts in the **Kronos / UKG Schedule Planner**, so nobody has to print the
schedule and retype it.

**How to use it:** see `INSTRUCTIONS.pdf` (or `INSTRUCTIONS.html`). It's written to read
easily on a phone.

## What it does

1. **Load and check.** Click the toolbar button, pick the Weekly Roster (.csv or .xlsx) and check every shift
   before anything happens. Names are turned into Kronos' "Last, First". Shifts that end after midnight are
   marked "next day". If someone works twice in a day, both shifts are kept. You can untick shifts, and fix
   names and jobs (the fixes are remembered for next week).
2. **Copy mode.** A panel on the Kronos page shows one shift at a time, with a copy button for each field (or
   "Copy next field"). You click into each Kronos box yourself and paste. Shifts get ticked off as you go, and
   your place is kept if you close Chrome.
3. **Auto-fill.**
   - *Show me once:* the helper watches you add one shift by hand, so it learns Kronos' add-shift form from
     what you actually do.
   - It then repeats those steps for each remaining shift. It works through the normal screen, one shift at a
     time, typing into the real boxes at a normal pace.
   - You approve each day's list first (or every single shift, if you choose that).
   - A Stop button is always there. If it can't find something on the screen, it stops and asks you.
   - Shifts that already look like they're on the schedule are flagged and left unticked.

4. **Job-change shifts.** Kronos fills in each person's usual (primary) job when a shift is added. The helper
   works out everyone's usual job (most worked that week; you can set it per person on the review screen, and it's
   remembered) and flags every shift with a different job, like a server working Bar:
   - *Copy mode* shows a red "BARTENDER shift - change the job for this one" box and outlines the Job copy button.
   - *Auto-fill* has an optional part 2 of Show me once: it fills in one flagged shift, waits before Save, and
     watches you change the job. After that it repeats those steps only on flagged shifts, and stops to ask if it
     can't find the job box or menu.

## What it doesn't do

- It doesn't sign in, store passwords, send data anywhere, or call Kronos in the background.
- It doesn't hide itself or pretend to be a person. It uses the same boxes and buttons you would.
- Please check with your manager that using it is OK.

## Files

| Path | What |
|---|---|
| `extension/settings.js` | **The one settings file**: Kronos address, name fixes, job map (Cocktail -> Server), how often it asks, typing speed, and the roster's column layout |
| `extension/roster.js` | Reads the roster CSV and formats names, dates and times for Kronos |
| `extension/review.*` | The load-and-check page (opened from the toolbar button) |
| `extension/kronos.js` | The panel on the Kronos page: Show me once, Auto-fill, and messages between frames (Kronos uses frames) |
| `extension/copymode.js` | Copy mode (on the Kronos page and on the review page) |
| `extension/lib/xlsx.full.min.js` | SheetJS Community Edition 0.18.5 (Apache-2.0), used to read .xlsx exports |
| `tests/` | Parser test, a mock Kronos page, and an end-to-end test in a hidden Chrome. The sample roster uses made-up names. |
| `build.py` | Builds the instruction PDF and the release zip |

## Roster format (from a real export)

The columns are `Employee`, then for each day Mon..Sun: `Shift` (`5:00 PM - 12:00 AM`, or `-` for none),
`Schedule` (Cocktail/Server/Bar/Bus/Host/Manager), `Job`, `Meal` and `Break`. Someone working a double gets a
second row. The week comes from the file name (`Weekly_Roster_10052026_10112026`). You can also pick it on the
review page.

## Tests

```
node tests/test_roster.js tests/sample_Weekly_Roster_10052026_10112026.csv
node tests/e2e.js tests/sample_Weekly_Roster_10052026_10112026.csv <work folder>
```

The e2e test loads the extension into a separate headless Chrome (its own temporary profile) and runs against
a **mock** Schedule Planner, where the add-shift form sits in a frame:

- review page
- copy mode
- Show me once (real clicks and typing)
- auto-filling a full day (every value checked against the roster)
- the "already there?" check
- job-change shifts: the copy-mode badge, teaching the job change (part 2), auto-filling a day with Bar shifts for
  servers, and stopping to ask when the job menu is missing

It hasn't been run against the real Kronos yet. That's why the add-shift steps are learned with Show me once
rather than written in by hand.
