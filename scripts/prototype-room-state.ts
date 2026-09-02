import { emitKeypressEvents } from "node:readline";

import {
  createInitialRoomState,
  memberDirectory,
  reduceRoom,
  type MemberId,
  type RoomState,
} from "../src/lib/room.ts";

let state: RoomState = createInitialRoomState();
let actor: MemberId = "spencer";

function render() {
  console.clear();
  const bold = "\x1b[1m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  console.log(`${bold}Hive multiplayer state prototype${reset}`);
  console.log(`${dim}Can teammates prompt, annotate, and steer the same live agent?${reset}\n`);
  console.log(`${bold}actor${reset}       ${memberDirectory[actor].name}`);
  console.log(`${bold}stage${reset}       ${state.stage}`);
  console.log(`${bold}run${reset}         v${state.revision}`);
  console.log(`${bold}annotation${reset}  ${state.annotation.status}`);
  console.log(`${bold}steeredBy${reset}   ${state.annotation.steeredBy ?? "—"}`);
  console.log(`${bold}version${reset}     ${state.version}`);
  console.log(`${bold}messages${reset}    ${state.messages.length}`);
  console.log(`\n${dim}${state.messages.at(-1)?.body}${reset}`);
  console.log(`\n${bold}[p]${reset} switch person  ${bold}[m]${reset} prompt Hive  ${bold}[s]${reset} steer from annotation`);
  console.log(`${bold}[f]${reset} finish run     ${bold}[a]${reset} approve       ${bold}[r]${reset} reset  ${bold}[q]${reset} quit`);
}

emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
render();

process.stdin.on("keypress", (_input, key) => {
  if (key.name === "q" || (key.ctrl && key.name === "c")) process.exit(0);
  if (key.name === "p") actor = actor === "spencer" ? "maya" : "spencer";
  if (key.name === "m") state = reduceRoom(state, { type: "send-message", actor, body: "I agree with the proposed behavior." });
  if (key.name === "s") state = reduceRoom(state, { type: "steer-agent", actor });
  if (key.name === "f" || key.name === "a") state = reduceRoom(state, { type: "advance-run", actor });
  if (key.name === "r") state = reduceRoom(state, { type: "reset", actor });
  render();
});
