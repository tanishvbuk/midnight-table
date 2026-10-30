# Playtest checklist

Three real games, back to back, with real people. The goal is the success criteria in
[`SPEC.md`](SPEC.md), not balance: the simulator cannot tell you whether the game is fun, and
neither can this checklist. Bring a notepad (or one person who is out of the game as scribe, if
you can spare them; otherwise the host jots notes between games).

## Success criteria

Copy this table into your notes and fill it in at the end.

| Criterion      | Pass when                                                                                     | Result |
| -------------- | --------------------------------------------------------------------------------------------- | ------ |
| Games finish   | 3 real games in a row run start to finish, with no server restart                             |        |
| No host needed | The host menu is used **at most once per game** (the castle announces each use)               |        |
| Secrets hold   | At the debrief, **nobody** says they read a role from someone's phone                         |        |
| It's fun       | The group asks for a rematch in **at least 2 of the 3** games                                 |        |
| It's robust    | A phone that locks or refreshes is back as the same player **within 5 seconds**, state intact |        |

A "restart" means stopping the server or abandoning a room and starting again. A phone reload, a
tunnel blip that recovers, or one dropped-and-returned player is not a restart.

## Before the night

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` is green on the commit you will run.
- [ ] `pnpm e2e` passes on the laptop that will host (optional but quick: about 3 minutes).
- [ ] Hosting is set up as in [`HOSTING.md`](HOSTING.md), and `https://…/healthz` answers.
- [ ] Bot rehearsal from your own phone **on mobile data**: create, add bots, start, lock the phone
      for 10 s, unlock, check you are back in under 5 s with your night pick still selected.
- [ ] Phones-only rehearsal (no TV): tick "No TV" in the lobby, start with bots, and check that vote
      reveal, the banishment speech and breakfast show on your phone and the night screen is unchanged.
- [ ] The castle screen is plugged in, sleep is off, and the browser tab is full screen.
- [ ] Sound off on phones. Brightness up. Do-not-disturb on (a notification banner on a locked
      phone is a tell).
- [ ] Decide the table size. 6 to 8 is the sweet spot and 8 is the first size with recruitment.
      Games take 45 to 75 minutes at 6 to 8, so plan about 4 hours for three, or run a 4 to 5
      player warm-up first (20 to 30 minutes) and count it separately.
- [ ] Tell everyone the house rules: phones face-down during discussion, never show your screen
      (Show my card is a forgeable prop), the host menu is for stalls only.

## Setting up each game

- [ ] One person creates the room and plays as host. Everyone scans the castle QR.
- [ ] Everyone adds a selfie or accepts the initial letter. Check the castle shows every face.
- [ ] Nobody joins late: the lobby closes when the game starts.
- [ ] **Role reveal:** check that each player holds to reveal alone, shielded from neighbours.
- [ ] Note the clock time the game starts.

## During each game (tick or note as you go)

**Phones**

- [ ] Night: every phone looks identical for the full 90 seconds. Does anyone's behaviour (typing
      a lot, staring, early tapping) give them away? Write down any tell people mention.
- [ ] Quiz: the 8 questions are playable one-handed; nobody got a question twice in the game.
- [ ] Vote: nobody could vote for themselves; run-offs (if any) were understood.
- [ ] Ghosts: the murdered or banished player knows what they can and cannot do.

**Castle**

- [ ] Text is readable from the far side of the room.
- [ ] Vote reveal: one vote at a time, people react. Is the pace right (4 s a vote by default)?
- [ ] Breakfast: arrivals then victim, the room reacts. The night screen gave nothing away.
- [ ] Narration lines read well. Note any that were wrong or confusing.

**Reconnects** (do at least one of each across the three games)

- [ ] A player locks their phone for ~10 s during a quiz, then unlocks. Time to be back: ____ s.
- [ ] A player refreshes the page mid night. Pick and note still there? ____
- [ ] A player turns Wi-Fi off and on during a vote. Was the vote kept or resent? ____
- [ ] A player closes the tab and reopens the link. Same seat? ____

**Escape hatch** (the castle announces each use, so you can also tally from the notices)

| Game | Pause | +60 s | Re-run vote | Drop player | End game | Why |
| ---- | ----- | ----- | ----------- | ----------- | -------- | --- |
| 1    |       |       |             |             |          |     |
| 2    |       |       |             |             |          |     |
| 3    |       |       |             |             |          |     |

Using it once per game is fine; twice means the auto-host stalled and that is a bug to fix before
the next game.

## After each game: the debrief (5 minutes, before anyone leaves the table)

Ask these out loud, one at a time, and write the answers down.

1. **"Did anyone read a role off someone else's phone, or work one out from how a phone looked or
   behaved?"** (Criterion: secrets hold. Ask Traitors and Faithful separately.)
2. "Did anyone use Show my card? Did it convince you or did you ignore it?"
3. **"Do you want to play again?"** (Count the hands. Criterion: rematch.)
4. "What was the most confusing moment?"
5. "Where did you wait around with nothing to do?"
6. "Was the night too long, too short, or fine?"
7. "Was anything on the castle unreadable?"

Then the open questions from the spec, one per game so the debrief stays short:

- Game 1: is 5 minutes the right Round Table discussion time?
- Game 2: should roles stop being revealed on banishment once the endgame starts? (The engine
  has the setting, `revealRoles: 'until-endgame'`; it is not exposed in the UI or the server's
  environment yet, so this is a question to ask, not something to toggle on the night.)
- After every game: did anyone open the replay, and did the castle's line-by-line replay hold the
  room or empty it? Was anything in it wrong or missing?
- Game 3: selfies or emoji avatars? Would a phones-only mode have been useful for the small game?

## Bug log

Write each problem as: what happened, which phase, which device (iPhone/Android, browser),
whether it recurred. Anything that stopped a game, leaked information, or took more than 5 s to
recover is a blocker for the next playtest.

| #   | Game | Phase | Device | What happened | Blocker? |
| --- | ---- | ----- | ------ | ------------- | -------- |
|     |      |       |        |               |          |

## Stop and call it

Stop the playtest, keep the room's log (`data/rooms/CODE.jsonl`) and note the room code if:

- the server crashes twice, or a game cannot reach the final reveal even with the host menu;
- anyone sees information they should not (a role, a pick, a vote before the reveal). Save the
  phone's screenshot and the log: the log replays the exact game from its seed.

## Results

| Game | Players | Length | Host menu uses | Rematch asked? | Role leaks reported | Slowest rejoin |
| ---- | ------- | ------ | -------------- | -------------- | ------------------- | -------------- |
| 1    |         |        |                |                |                     |                |
| 2    |         |        |                |                |                     |                |
| 3    |         |        |                |                |                     |                |

Verdict against the five criteria above, and the top three things to fix before the next night.
