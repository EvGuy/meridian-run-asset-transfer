export const MODULE_ID = "meridian-challenge";

/** Shared mutable module state. `ctl` exists only on the controlling GM client. */
export const state = {
  lastScene: null,
  socket: null,   // socketlib module socket
  ctl: null,      // { seq, run, party, ui, controllerId }
  view: null,     // last public view broadcast to everyone
  window: null    // the open ChallengeWindow on this client
};
