// ============================================================================
//  SCHEDULE HELPER - SETTINGS  (the one file to change if something maps wrong)
// ============================================================================
//  Everything here can also be changed on the review screen; what you change
//  there is remembered and wins over these defaults.
// ============================================================================

globalThis.SH_DEFAULTS = {
  // Zack's Kronos Schedule Planner (the "Open Kronos" button on the review screen).
  kronosUrl: "https://landrys-landrysprdsso.prd.mykronos.com/schedule#/",

  // How a HotSchedules name ("Jamie Avery") looks in Kronos ("Avery, Jamie").
  // The LAST word is taken as the last name. Fix odd ones (two last names,
  // "Jr.", nicknames) under nameOverrides on the review screen, e.g.
  //   "Mary Ann Smith": "Smith, Mary Ann"
  nameOverrides: {},

  // Which Kronos job each HotSchedules "Schedule" becomes.
  // Anything not listed uses the HotSchedules "Job" column as-is
  // (the export already says Job = Server for Cocktail shifts).
  // Each person's usual Kronos job (the one Kronos fills in) is worked out from the
  // week; shifts with a different job are flagged. Set it per person on the review
  // screen ("Usual job in Kronos") if the guess is wrong.
  jobMap: {
    Cocktail: "Server",
  },

  // When to ask before saving: "day" = approve each day's list once,
  // "shift" = approve every single shift.
  confirm: "day",

  // Typing speed and pauses (milliseconds). A normal person's pace.
  pace: {
    keyMin: 70, keyMax: 160,       // between letters
    stepMin: 500, stepMax: 1200,   // between clicks/fields
    shiftMin: 1500, shiftMax: 3000 // between shifts
  },
};

// The HotSchedules "Weekly Roster" CSV layout (from Weekly_Roster_10052026_10112026.csv):
//   Employee, then for each day Mon..Sun: "<Day> Shift", "<Day> Schedule", "<Day> Job", "<Day> Meal", "<Day> Break"
//   Shift looks like "5:00 PM - 12:00 AM"; "-" means nothing that day.
//   Someone working a double has a second row with the same name.
//   An end time earlier than the start (12:00 AM, 1:00 AM...) is the next day.
globalThis.SH_FORMAT = {
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  employeeColumn: "Employee",
  shiftColumn: "Shift",
  scheduleColumn: "Schedule",
  jobColumn: "Job",
  empty: "-",
};
