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
