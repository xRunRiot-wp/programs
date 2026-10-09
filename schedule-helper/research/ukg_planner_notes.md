# UKG Dimensions / Kronos Schedule Planner: how adding a shift works

Short notes for the Schedule Helper recorder (v3). Written 2026-10-09 from public UKG docs,
university quick-reference cards, and Zack's two screenshots. Where something is a guess, it says so.

## What Zack's screen is (input/s3.jpg)

- Title bar: **"Schedule Planner with Absence Calendar"** (UKG logo, teal bar).
- "View by employee" dropdown, toolbar: **Quick actions, Show/Hide, Table view, Zoom**; right side: date range
  ("Yesterday Plus 6 Days"), location, "Loaded <time>", **Share, Refresh, Save**.
- It is the **Gantt (timeline) view**, not Table view. The toolbar button says "Table view", which means
  he is currently in the other view.
  - Column header has 2 rows: a day row ("Tue 10/06", "Wed 10/07"...) and, under each day, hour ticks
    **12A 4A 8A 12P 4P 8P**. A week label row above that ("Tue 10/06 - Sat 10/10", "Sun 10/11 - Mon 10/12").
  - Rows: checkbox + **"Last, First"** name, header "Name (0/54)".
  - Shifts are purple/blue bars placed by time, labelled "5:00 PM - 12..." (text cut off).
  - A vertical magenta line marks "now".
  - Bottom tabs: **Absence calendar, Comments, Audit**.

## How a shift gets added (evidence)

1. **Gantt view: click an empty spot in the employee's row, under the day.** Zack's Show-me-once
   (input/zack_showmeonce_issue.png) recorded step 1 as a click on "a spot with no words", and step 2 is
   inside a panel whose text reads "Regular [1.00] Start time End time 10/26 Transfer...". So one click on
   empty timeline space opened the add-shift panel. **"[1.00]" = a 1-hour segment**, so Kronos most likely
   creates a 1-hour shift where you clicked and opens the panel to edit it (the hour depends on where in
   the day you clicked). Replay must **overwrite** Start/End, never assume they're empty.
2. **Table view: "Shifts can be added or edited by clicking in the individual cell"** (Kronos Coach,
   Retail Schedule Planner). One cell per person per day there.
3. **Right-click employee name -> "Add Shift"** (one day) or "Schedule Pattern" (several days) (GWU card,
   older Workforce Timekeeper). Possible fallback.
4. **Quick actions -> Insert Shift Template**, pick a template, then click the day/row cell, then
   **Save** (U. Rochester "Add Open Shifts", 3/25/26). Only useful if they use templates.
5. Existing shift: **right-click -> Edit** opens the "Edit Shift" panel (Rochester "Transfer a Shift").
   Gantt: double-click an existing shift edits it. Nothing says double-click adds one.

## The shift panel (Rochester "Transfer a Shift by Editing", 2/25/26 screenshot)

A slide-in panel on the right, top to bottom:
- Title **"Edit Shift"** (likely "Add Shift" when new) with an **X** close.
- Summary line "D8 7:00 AM-3:30 PM [8:30]" (template name, times, total hours in brackets).
- **Employee dropdown** ("Adams, Eliza") with the job path under it ("Senior Associate .../Senior Associate").
- A small draggable timeline bar of the shift.
- Per segment: **segment-type dropdown "Regular"** with hours "[8:30]", then **Start Time** and
  **End Time** inputs (text like "7:00 AM"), the **date "11/06"** at the right (matches Zack's "10/26"),
  and a link **"Transfer Employee"** (that's the "Transfer..." in Zack's text).
- **Comments [0]** + "Add Comment".
- Footer: **Cancel** and **Apply**.
- **Apply only closes the panel; the shift is not stored until the toolbar Save** ("Save your changes").

Segment types (UKG library, Edit Single Shift): **Regular** = the person's primary job/location;
**Transfer** = a different job/location (opens the Transfer slider); **Break**.

## Changing the job (job-change shifts like server on Bar)

"Transfer Employee" -> a menu of recent transfers; if missing, **More** -> Transfer panel with four
headings: **Business structure** (pick location, then job), Work rule, Payer cost center, Labor
category -> **Apply** (back to shift panel) -> **Apply** -> toolbar **Save**.
Alternatively set the segment type dropdown from Regular to Transfer.

## DOM (unknown: needs a debug export from Zack)

No public docs show the HTML. What we can reasonably expect, given it's a modern web app (UKG's UI is
Angular, with `krn-`-style components):
- The Gantt body is probably absolutely positioned divs, not a `<table>`. Empty timeline space is likely
  one big row element with **no text and no aria-label**, which is why the v2 recorder found "no words".
- So the recorder should locate the click **geometrically**: row = the row whose name header is at the
  same height (y), day = the day header covering that x position; hour = position inside the day.
  It should still use `role=row/gridcell`, `aria-label`, `data-*` (date/employee ids) if they're there.
- Panel inputs: expect labels ("Start Time"/"End Time") as nearby text or `aria-label`, not wrapping
  `<label>` elements. The v2 recorder grabbed the panel's whole text, so the inputs probably sit inside a
  container without a direct `<label for>`.
- Times are typed as text ("7:00 AM"); the field may reformat on blur.
- Case/labels may differ ("Start time" in Zack's capture vs "Start Time" in the Rochester card), so
  match case-insensitively.

**Recommendation:** ship the "debug export" button so Zack can send one click's details (element tag,
attributes, aria, row/day header found) - that settles the real structure.

## What the mock (tests/mock_kronos/planner.html) copies from this

- Gantt view by default: name row headers ("Last, First"), day headers ("Tue 10/06") with hour ticks,
  empty row space with no text/aria; click = 1-hour shift at the clicked hour + slide-in "Add Shift" panel.
- `?view=table` = Table view (one cell per person/day, still no text in empty cells).
- `?open=dblclick` / `?open=menu` = panel opens on double-click, or on right-click -> "Add Shift" menu.
- Panel: employee + job line, "Regular" segment-type dropdown (Regular / Transfer / Break), Start Time /
  End Time text inputs (pre-filled 1-hour), date, "Transfer Employee" link -> job menu, Comments, Cancel /
  Apply. Apply puts a pending bar on the grid; toolbar **Save** stores everything (`window.added`).
- `?aria=1` adds role=grid/row/gridcell + aria-labels "<name> <date>" for the friendlier case.

## Sources

- UKG library, Edit a Single Shift: https://library.ukg.com/docs/en-us/UKG_Dimensions/Timekeeping/Basic_Schedules/Edit_Single_Shift/Edit_Single_Shift.html
- U. Rochester, Transfer a Shift by Editing the Shift (Edit Shift panel picture): https://tech.rochester.edu/wp-content/uploads/Transfer_a_Shift_Using_Edit_Shift.pdf
- U. Rochester, Add Open Shifts (Gantt planner, Insert Shift Template, Save): http://tech.rochester.edu/wp-content/uploads/Add-Open-Shifts.pdf
- U. Rochester, Schedule Planner Table View (table view layout): https://tech.rochester.edu/wp-content/uploads/Schedule-Planner-Table-Visual-Queues-Scheduling.pdf
- U. Rochester UKG tutorials index: https://tech.rochester.edu/ukg-tutorials/
- Kronos Coach, Retail Schedule Planner ("clicking in the individual cell"): https://kronoscoach.kronos.com/cs/41245/content/d_retailscheduleplanner.html
- GWU payroll tip (right-click name -> Add Shift): https://hr.gwu.edu/sites/g/files/zaxdzs5691/files/downloads/PayrollTips_Schedules_How%20to%20assign%20a%20schedule%20Pattern.pdf
