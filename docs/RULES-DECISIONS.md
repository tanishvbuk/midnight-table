# Rule decisions

Calls the engine makes where `docs/SPEC.md` is silent, ambiguous or contradictory. Items marked
**(agreed)** were confirmed with the project owner before building; the rest are my calls and
should be reviewed.

## Reading of the presets

- **(agreed)** 6–7 players have 1 Traitor and no recruitment; 8 players have 2 Traitors and
  recruitment. The "On with 2 Traitors" cell is read as "recruitment applies when the game started
  with 2 or more Traitors".
- **(agreed)** A game that started with 1 Traitor never has a recruitment night.
- **(agreed)** 4–5 player games skip the Night and Breakfast entirely: Mission → Round Table →
  Mission → …
- **(agreed)** If a murder brings the alive count to the endgame threshold, the endgame starts at
  the next Round Table.
- The game also ends at 2 players in every preset.

## Engine shape

- The RNG state (a mulberry32 `uint32`) lives inside `GameState` and is seeded by `createGame`,
  rather than being passed to every `apply` call. `apply` stays pure and replayable from the seed
  and the action list. Views never include it.
- `timeout { epoch }` is the only way time passes. `state.epoch` bumps on every phase change and on
  every sub-step (each vote reveal, each breakfast arrival). A timeout with an old epoch is
  rejected, so a late timer can't double-advance a phase.
- Phases advance on their own when every input is in, except **Night**, which only ends on its
  timer so nobody's speed gives anything away.
- `apply` rejects an illegal action by returning `{ state: <the same object>, events: [], error }`.

## Night and recruitment

- **Recruitment with 2+ Traitors left is two nights back to back**: a recruit night (the single pick
  is the recruit) followed by a normal murder night, then one Breakfast. The spec says the murder
  "still happens" but the night screen only has one pick, so a second night is the only way to keep
  every phone identical.
- The recruit's offer screen is a separate short phase (`recruitOffer`). Everyone sees the same
  phase and timer; only the recruit's `you.offer` is set.
- An unanswered offer counts as a decline, and an ultimatum decline kills the recruit. A Shield
  blocks that kill like any other murder. Accepting an ultimatum means no murder that night.
- Traitors can pick anyone, so the screen is identical, but a Traitor pick on a Traitor (or on
  themselves) is ignored. Missing picks default to a random Faithful for Traitors and a random other
  player for Faithfuls. If no valid Traitor pick exists, a random Faithful is chosen.
- The victim stays alive in the state, and in every view, until Breakfast announces them, so the
  victim's phone only changes at that moment. A murdered player's role is not revealed (the victim
  is always a Faithful). Banished players' roles are revealed unless the `until-endgame` setting
  applies.
- A recruited Traitor sees the whole Traitor chat history, and recruited Traitors count as
  Traitors for every later rule and for the payout.

## Missions

- Each player submits all their answers in a single action (`submitAnswers`). Alive players only;
  the mission ends when all are in or the timer expires (missing answers score zero).
- The top scorer must have scored above zero. Ties are broken at random.
- Reward: a Shield in murder games before the endgame; a Faithful clue (a random living Faithful
  other than the winner) in 4–5 player games; nothing in a murder game's endgame, since no night
  follows.
- A Shield lasts until the next murder resolution, or until the next mission starts, whichever is
  first. Only the pot total is public.
- 100 points per correct answer. The bank has 150+ original questions in 11 categories; a game
  never repeats a question until the bank is used up (`GameState.asked`, never in a view).

## Round Table

- "Ready to vote" opens voting at ⌈2/3⌉ of the living players, or when the timer ends.
- A ballot can be an explicit abstention (`target: null`); a missing ballot is treated the same.
- If every ballot is an abstention the vote is a tie between everyone, which leaves nobody to vote
  in a run-off, so a random draw picks the banished player. The same shortcut applies whenever a
  tie leaves no eligible run-off voters.
- Vote reveals are one engine step per voter (shuffled order, abstentions included), then one more
  step to tally.
- In the endgame, each Round Table starts with the end-or-continue vote, then discussion and a
  normal vote. A missing endgame ballot counts as "continue".
- **The game ends immediately when the last Traitor is banished** (Faithful win). The spec only
  ends the game at the endgame vote or at 2 players, but there is nothing left to play.

## Payout

- Winners are the surviving players of the winning side. Traitors win if any Traitor is alive. The
  pot is split with integer division; the remainder is discarded.

## Secrecy

- A player's view contains their own role only during the role-reveal phase. After that the only
  role-related thing on a phone is the identical `card`. Traitors keep a `team` list, which is how
  they know they are Traitors.
- Dead players get the public view plus their own ID. They see no shield, clue, journal or chat.
- The phase name `recruitOffer` is public, since recruitment after a Traitor banishment is a
  known rule.

## Not in M1

The escape-hatch actions (R21), device tokens and rejoin (R3), narration text (R20), and server-side
bots (R22) belong to the server work in M2. The simulator's bots are in `packages/sim`.

## M2: server and clients

- **Escape hatch.** Pause/resume, +60 s, re-run vote, drop player and end game are host-only and
  each use is announced to every screen as a notice. `rerunVote` and `endGame` are engine actions
  (no actor; the server authenticates the host). Re-running clears ballots and restarts the same
  vote, including from the reveal step. Pausing also blocks player actions and bots.
- **Dropping a player** in the lobby removes them. In a game it hands their seat to autopilot (the
  same random-legal-action bot used for bot seats) and closes their socket; if they reconnect with
  their token they take the seat back.
- **Bots** are server seats. With any human not on autopilot at the table, bots never press "Ready
  to vote", so humans get the discussion; bots-only tables ready up immediately.
- **Timers.** The server arms one timer per engine epoch. A pause stores the remaining time; "add
  60 s" re-arms with remaining + 60 s. `TIME_SCALE` shrinks all timers, including the night, for
  demos and tests.
- **Rejoin.** Seats are keyed by a random token the phone keeps in `localStorage`; the server
  re-sends the full view on reconnect. A client never supplies an actor: the server binds it.
- **Persistence.** Each room appends `create`, `seat`, `autopilot` and accepted `act` entries to
  `data/rooms/CODE.jsonl`. Because the engine is deterministic from its seed, replaying the log
  rebuilds the exact state; timers and bots restart from the top of the current step.
- **Castle events.** The castle receives public events with each state message. Phones receive none:
  everything private reaches a phone only as its own view.
- **Night screen.** Every phone renders the same night layout. The notes panel shows the Traitor chat
  for Traitors and the private journal for everyone else.
- **Ghost predictions (R26)** is a Should item and is not built.

## M4: phones-only mode (R24)

- **How it is switched on.** The creator ticks "No TV" in the lobby (host command `phonesOnly`). It
  cannot change once the game has started, and it is written to the room log so a restart keeps it.
  It is not auto-detected: a castle that drops mid-game must not change what phones show.
- **What phones get.** The state message carries `phonesOnly` and `publicView`, which is exactly the
  castle's view (never role-dependent, so it cannot leak). Phones render the castle's panel for the
  public phases they would otherwise wait through: vote reveal, banishment speech and breakfast.
  Ghosts see the same panels under their ghost card. Narration was already sent to phones.
- **Night.** Nothing changes: every phone keeps the identical night screen and no night panel is
  shown. Public events are still sent to the castle only.
- **A castle may still join** a phones-only room; both get the same public information.
- **Open.** Public panels are shown in the phone's own layout, not the TV's, and have only been
  looked at in Chromium at 390x844. Whether a shared phone feed is readable and paced well is a
  playtest question.

## M3: playtest preparation

- **Hosting.** Laptop behind an HTTPS tunnel is the primary plan; a small VPS with Caddy is the
  documented backup. See `docs/HOSTING.md`. My call, not agreed: say so if you prefer the VPS.
- **Resending actions.** Every `act` carries a client id (`cid`). The server applies each id once
  and always acks it, so a phone can resend everything unacked after a reconnect without doubling
  a night note. Host commands are never queued or resent, because "add 60 seconds" twice is not
  the same as once.
- **Join is idempotent.** The phone picks its own seat token before the first hello; a join whose
  reply was lost is retried with the same token and name and takes the same seat.
- **Drafts.** The quiz answers so far, the vote pick and the night note are kept in local
  storage, tagged with the phase epoch, so a reload resumes them. They are never sent early.
- **Dead sockets.** A locked phone usually keeps a socket that looks open. The client probes on
  wake-up and drops the socket if nothing comes back in 1.2 s; the server pings every 10 s.
- **QR address.** Castles and the host's phone use the server's idea of the public address when
  the page was opened on a local one, so a castle opened at `localhost` still shows a QR that
  works for phones.
- **Night screen.** The castle shows a moon and nothing else tied to the night: no counts of who
  has picked, no per-player status beyond who is alive. Phones keep one identical layout for
  every role; only the contents of the notes list differ, as before.
- **Not exposed in the UI.** Timers and the role-reveal setting are engine config only. The spec
  says the creator can adjust timers; there is no screen for that yet.

## M4: replay (R27)

- **What is recorded.** `GameState.history` keeps the events the replay needs (votes, run-offs,
  banishments, murders and failed murders, Shields and clues, recruitment steps, endgame votes and
  notes). It is rebuilt exactly when a room is restored from its log, and it is never in a view
  before the final reveal.
- **What is shown.** The final-reveal view carries `timeline`: plain lines grouped by "Day N" or
  "Night N". It is the same for every viewer, because by then every role is public. It names each
  banished player's role. A phone gets a "Replay the game" button; the castle plays it one line
  every 3 seconds under the final table.
- **Not in it.** Who each Traitor picked at night (only the outcome is shown), quiz answers, and
  who held a Shield but was never targeted.
- **Open.** Whether the 3 s pace and the amount of detail suit a real table is a playtest question.
