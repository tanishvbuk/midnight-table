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
- 100 points per correct answer. The question bank is a 24-question placeholder.

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
- **Phones-only mode (R24), ghost predictions (R26) and replay (R27)** are Should/Could items and are
  not built.

## Before the first playtest

### Avatars: emoji, not selfies

Decided: every player has an emoji avatar. Selfies are not in v1.

- The join screen shows a grid of 24 emoji and starts each player on a random free one. The server
  checks every request: a taken emoji, an unknown string, selfie data or long text is replaced with
  a free emoji, so two players can never share one and nothing but a listed emoji can reach the
  castle. Bots get one too. 24 is more than the 16-seat maximum, so a free one always exists.
- Why not selfies: R4 asks for joining in under a minute, and a selfie adds a camera permission, a
  photo payload through the WebSocket, and HEIC and orientation edge cases, all on guests' own
  phones. An emoji is one tap and cannot fail. At a game night everyone already knows each other's
  faces, so a portrait adds little. It also lets the camera and HTTPS question go away: the only
  thing left that needs HTTPS is the Wake Lock.
- The engine's avatar field is capped at 16 characters, so image data cannot be sent by mistake.
  Selfies can come back as an M4 option if the playtest asks for them.
- R2 now reads "a name and an emoji avatar".

### Quiz bank: written for this project, in the repository

Decided: the bank is original questions, authored with Claude and committed in
`packages/engine/src/questions.ts`. About 170 questions in 8 categories (geography, science,
history, screen and music, food, sport, words, general).

- Why not an openly licensed set: Open Trivia DB and similar sets carry attribution and share-alike
  terms, need a build or runtime import step, and are uneven in quality and wording. This is a
  private game with no licence to honour; owning the text avoids all of that and keeps the server
  free of network calls.
- Why this size: a 16-player game runs up to about a dozen missions of 8 questions. A game never repeats a
  question until the bank is spent, and the bank holds well over a game's worth, so a group can play
  a few games in a night.
- Authored with the right answer first, so there is no index to get wrong. The engine shuffles the
  options every time a question is asked, which keeps the right answer in each position about 25%
  of the time and stops anyone learning a pattern.
- A mission takes at most 3 questions from one category, so no one topic decides it.
- The engine remembers which questions a game has asked (`usedQuestions`) and starts over only if
  fewer than a mission's worth remain.
- The answer key (`correct`) never leaves the server; a test checks every view.
- Tests also check the bank's shape: no duplicate questions or options, length limits for a phone
  screen, no "all of the above", and every category with real depth. Adding a bad question fails CI.
- Accuracy: questions use stable facts and avoid anything that changes (office holders, records,
  prices). A wrong question is the one thing a friend group will argue about, so please flag any you
  catch and they will be fixed. Group-specific questions can be an M4 item.

### Reconnecting (R3)

- The phone's connection logic is a framework-free `GameClient`, tested against a real server. A
  dropped socket retries after 150 ms, then 400, 800 and 1500 ms.
- A locked phone often keeps a socket that looks open but is dead. On unlock, a network change or a
  restored page, the client pings and replaces the socket if nothing answers within 1.2 s. A
  heartbeat does the same every 4 s, and sending an action starts the same 2.5 s check, so a Wi-Fi
  blip cannot swallow a tap silently.
- Actions tapped while offline, or sent into a dead socket, are queued (the latest of each kind,
  at most 5, for at most 30 s) and sent once the seat is back. The server already ignores a stale
  or repeated action, so a resend is harmless.
- The seat is the device token, so none of this can change who a phone is. A seat the server no
  longer knows ends in an error screen and no retry loop.
- Measured in tests on the real clock: clean drop, a dead socket plus catching up on what was
  missed, refresh, and the castle all return in well under the 5 s budget. In Chromium, a refresh,
  a dropped socket and an offline blip rejoined in 57 ms, about 1.3 s and 32 ms with the page
  unchanged. `pnpm reconnect` repeats the browser check.
- Not covered: a quiz half answered when the page is refreshed starts again from question 1,
  because answers are held on the phone until the last one. The mission timer still applies.

### Screens

- The castle screen is laid out for a 16:9 TV: a header with room code, pot and timer, a centred
  stage with the narration and the phase's focus, and a roster that scales to fit 16 players at
  1280x720. Seats show a tick when a player has done what the phase waits for (looked at their
  card, answered, readied, voted). That is already public information.
- Ghosts get their own phone screen and no "Show my card" or peek footer, since a ghost has nothing
  to prove or hold. Phones show the footer only while a game is in progress.
- `pnpm screens` reproduces the screenshots in `docs/screens`. Two of them (the recruitment offer
  and the ghost view) depend on chance, so that script reaches them by replaying an engine log and
  rejoining by token; everything else is clicked through live.
