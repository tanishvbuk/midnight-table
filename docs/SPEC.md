# Midnight Table — Project Plan

Oct 30, 2026 · @Tanish · Personal project, not for release

## Overview

Midnight Table is an in-room party game in the style of *The Traitors* for 4 to 16 friends. Each player's phone is a private controller, a shared laptop or TV acts as the castle screen, and the app runs the whole game itself. There is no human host, so everyone plays, including the person who built it.

This is a personal project for private game nights. It won't be published, so it can use the show's terms (Traitor, Faithful, Round Table, Shield) freely.

## Objectives and success criteria

**Objectives**

1. Run a full game with no human host. The app deals roles, runs every phase, scores missions and referees votes.
2. Work from 4 players up, with rules that adapt to group size.
3. Make roles impossible to prove or leak. No screen can be shown as evidence, and Traitor and Faithful phones look and behave the same.
4. Join in under a minute from a QR code, with no install or account.

**Success criteria**

| Criterion | Measure |
| --- | --- |
| Games finish | 3 real games in a row run start to finish with no restart |
| No host needed | The escape-hatch menu is used at most once per game |
| Secrets hold | In the post-game debrief, nobody says they read a role from someone's phone |
| It's fun | The group asks for a rematch in at least 2 of the first 3 playtests |
| It's robust | A phone that locks or refreshes rejoins within 5 seconds with its state intact |

## Scope

**In v1 (the first playable build)**

- Lobby with QR or room-code join, and automatic rejoin
- Role dealing with presets for 4 to 16 players
- Night murder, with identical night screens for every role
- Breakfast reveal
- An automated phone quiz mission that awards a Shield or a clue
- Round Table vote with one-by-one reveal, ties and banishment
- Recruitment and the ultimatum
- Endgame vote and pot payout
- Auto-host: timers, defaults and narration text on the castle
- An escape-hatch menu for the room creator
- Bot players and a simulator, so the game can be tested solo

**Later**

- Physical mission cards, a phones-only mode with no castle, ghost predictions and an end-of-game replay
- Seer, Dagger, Secret Traitor and no-murder nights
- Voice narration, music and a weekend mode

**Out of scope**

- Public release, app stores or a hosted service for other groups
- Remote play over video
- Real money
- Accounts or player profiles
- A human host mode

## Constraints and decisions

**Constraints**

- One builder, working through Claude Code cloud sessions.
- Played on home Wi-Fi, in phone browsers, by guests who won't install anything.
- The room creator is also a player, so no device may ever reveal hidden information to them.

**Decisions**

| Decision | Choice | Why |
| --- | --- | --- |
| Host | Fully automated, with no human host | The builder wants to play |
| Minimum players | 4, with small-game rules | Lets small groups play. The full show loop needs 6 or more |
| Server | One Node and WebSocket server holding each room in memory, with an event log on disk | The simplest authoritative referee. It runs locally or on any small host |
| Language | TypeScript throughout | One rules engine shared by the server, the web app and the simulator |
| Role proof | A forgeable "Show my card" button | Stops Faithfuls proving their innocence by showing their phone |
| Screen awake | The Wake Lock API in a normal browser tab, not a PWA install | Guests don't install anything |
| Branding | The show's terms are fine | Private use only |

## Game design

### Phase loop

Role reveal → Day 1 (Mission → Round Table) → Night → Breakfast → Mission → Round Table → Night → … → Endgame → Final reveal.

There is no murder before the first Round Table, because the Traitors have nothing to go on yet.

### Player-count presets

The app picks a preset from the headcount when the game starts. Timers are the only thing the creator can adjust.

| Players | Traitors | Murders | Recruitment | Endgame starts at | Rough length |
| --- | --- | --- | --- | --- | --- |
| 4–5 | 1 | None | Off | 3 players | 20–30 min |
| 6–8 | 1 (2 at 8) | Every night | On with 2 Traitors | 3 players | 45–75 min |
| 9–12 | 2 | Every night | On | 4 players | 1.5–2.5 h |
| 13–16 | 3 | Every night | On | 5 players | 2–3 h |

A 4 or 5 player game is a quick game, not the full show. It lasts two or three votes, so play it best of three. Without murders, missions give information instead: the mission winner privately learns one player who is definitely Faithful. The full experience starts at around 8 players.

### Night

- Every phone shows the same screen for a fixed 90 seconds. It can't end early, so nobody's timing gives anything away.
- Every player picks a player and types in a note box. For Faithfuls, the pick is a suspicion and the note goes to a private journal. For Traitors, the pick is their murder vote and the note box is the Traitor chat. The layout is identical either way.
- The victim is the plurality of Traitor picks. A tie goes to a random draw among the tied players. If no Traitor picks anyone, the app chooses a random Faithful.
- A Shield blocks the murder silently. The Traitors are told only that the murder failed.
- **Recruitment night** (after a Traitor is banished, in games that started with 2 or more Traitors): the Traitors pick a Faithful to recruit. With 2 or more Traitors left, the recruit can decline, and the night's murder still happens. With 1 Traitor left, it's an ultimatum: decline and the recruit is the night's victim.

### Breakfast

The castle reveals surviving players' portraits in a shuffled order, then names the victim or says nobody died. The victim's phone switches to a ghost view at the same moment. Ghosts can't act and see nothing secret.

### Mission (automated)

- v1 has one mission type: a quickfire quiz of about 8 questions, played on every phone at once from a bundled question bank.
- Each correct answer adds a set amount to the pot. The castle shows only the pot total, never individual scores.
- Traitors play the same quiz and can sabotage by answering wrongly, which nobody can detect.
- The top scorer, with a random tie-break, privately receives a Shield for the next night. In 4 to 5 player games, they receive a Faithful clue instead.

### Round Table

- A discussion timer runs on the castle (5 minutes by default). Players tap "Ready to vote", and voting opens when two-thirds are ready or the timer ends.
- Voting is secret, on phones, with a 45-second limit. You can't vote for yourself, and a missing vote counts as an abstention.
- The castle reveals votes one at a time: the voter's portrait, then their choice.
- A tie goes to a run-off between the tied players, who don't vote. A second tie goes to a random draw.
- The banished player gets a 30-second speech timer, then their role is revealed. A setting can stop role reveals once the endgame starts.

### Endgame

- Once the player count reaches the threshold, there are no more murders.
- Each Round Table opens with a secret vote: end the game, or banish again. A unanimous vote to end goes to the final reveal. Otherwise, a normal banishment follows.
- The game also ends at 2 players.
- If any Traitor survives, the Traitors take the pot. Otherwise, the surviving Faithfuls split it. The final reveal shows every role.

### Auto-host

- The server moves each phase on when every input is in or the timer ends. Missing inputs get defaults: a random night pick, or an abstention.
- The castle shows a line of narration for each phase. Voice narration comes later.
- The room creator gets an escape-hatch menu: pause and resume, add 60 seconds, re-run the current vote, drop a disconnected player, and end the game. It never reveals anything secret, and the castle announces every use.
- There is no "fix a vote" or "see all roles" feature anywhere, because the creator is a player.

### Secrecy rules

- Each player sees their role once, by pressing and holding, at the start of the game. After that, a "Show my card" button on every phone, including Traitors' phones, displays a Faithful card identical to the real one. A shown card proves nothing.
- Every phase looks and lasts the same on every phone, whatever the role.
- The server sends each device only what it may see. The castle receives only public events.
- Votes stay on the server until the castle reveals them.

## Requirements

The priorities are Must, Should, Could and Won't. v1 is every Must and nothing else.

| ID | Area | Requirement | Priority |
| --- | --- | --- | --- |
| R1 | Lobby | The creator starts a room. The castle, or the creator's phone if no castle has joined, shows a QR code and a 4-letter room code. | Must |
| R2 | Lobby | Players join with a name and an optional selfie, with no account or install. | Must |
| R3 | Lobby | A locked or refreshed phone rejoins as the same player within 5 seconds, using a device token. | Must |
| R4 | Lobby | The game starts with 4 to 16 players and applies the matching preset. | Must |
| R5 | Roles | The server deals roles at random. Press-and-hold reveal. Traitors see each other. | Must |
| R6 | Roles | A "Show my card" button on every phone displays an identical Faithful card. | Must |
| R7 | Night | An identical 90-second night screen for every role: a player pick and a note box, which is the chat for Traitors. | Must |
| R8 | Night | The murder goes by plurality, with a random tie-break and a fallback when nobody picks. | Must |
| R9 | Night | A Shield silently blocks the murder. | Must |
| R10 | Night | Recruitment and the ultimatum, as described under Game design. | Must |
| R11 | Breakfast | Shuffled arrival reveal, then the victim. The victim's phone switches to ghost view. | Must |
| R12 | Mission | Quiz mission on phones from a bundled question bank. Only the pot total is shown. | Must |
| R13 | Mission | The top scorer gets a Shield, or a Faithful clue in 4 to 5 player games. | Must |
| R14 | Round Table | Discussion timer and "Ready to vote". | Must |
| R15 | Round Table | Secret vote on phones, with no self-votes, and a one-by-one reveal on the castle. | Must |
| R16 | Round Table | Ties go to a run-off, then a random draw. | Must |
| R17 | Round Table | Banishment speech timer and role reveal, with the endgame reveal setting. | Must |
| R18 | Endgame | End-or-continue vote, the end at 2 players, the pot payout and a final reveal of all roles. | Must |
| R19 | Auto-host | Phase machine with timers and default inputs. | Must |
| R20 | Auto-host | One line of narration text per phase on the castle. | Must |
| R21 | Auto-host | Escape-hatch menu for the creator, with every use announced. | Must |
| R22 | Testing | Server-side bot players that can fill a room. | Must |
| R23 | Testing | A command-line simulator that runs thousands of bot games. | Must |
| R24 | Castle | Phones-only mode: if no castle joins, public events show on every phone. | Should |
| R25 | Mission | Physical mission cards, with a group pass or fail vote. Optional per room; replaces every other quiz. | Should |
| R26 | Ghosts | Ghost view with predictions: a private guess at who the Traitors are, scored at the end. | Should |
| R27 | Post-game | Replay timeline of every murder, vote, recruitment and Shield, plus the Traitor chat and Faithful notes. | Should |
| R28 | Twists | Seer, Dagger, Secret Traitor and no-murder nights. | Could |
| R29 | Castle | Voice narration and music. | Could |
| R30 | Format | Weekend mode across real days. | Could |
| R31 | Scope | Public release, remote play, real money and a human host. | Won't |

## Technical approach

**Architecture:** one web app with three views (castle, player and creator menu) talking over WebSockets to one server, which is the only referee. Every action goes to the server, the rules engine checks it, and a view filter sends each device only what it may see.

**Repository layout:** a pnpm monorepo in strict TypeScript.

- `packages/engine`: the pure rules engine. `apply(state, action)` returns the new state and a list of events. It has a seeded random number generator and no input or output, plus `view(state, viewer)` for per-device projections.
- `packages/sim`: a command-line simulator that runs bot games against the engine.
- `apps/server`: Node with WebSockets. It holds one room in memory per game and appends every event to a log file on disk, for crash recovery and the replay.
- `apps/web`: Vite and React, with routes for the castle, the player phone and joining.

**Testing:** Vitest, with property-based tests (fast-check) for these invariants:

- Every game ends.
- Eliminated players can't act.
- The castle view never contains a hidden role.
- A player's view never contains another player's role, unless both are Traitors or the role has been publicly revealed.
- At most one player dies per night.
- The pot is never negative.

The simulator checks that the rules are correct, not that the game is balanced. Bots that vote at random can't tell you who wins real games, so balance comes from playtests.

**Hosting:** develop locally. For game nights, run the server on a small Node host or on a laptop behind an HTTPS tunnel. The Wake Lock API and the selfie camera both need HTTPS. Decide which at M3.

**Browsers:** iOS Safari 16.4 or later (for Wake Lock), Android Chrome, and desktop Chrome, Edge and Safari.

## Milestones

Each milestone starts only once the previous one meets its exit criteria. There are no dates, because this is a personal project.

| Milestone | Deliverables | Exit criteria |
| --- | --- | --- |
| M0 Setup | Repository, monorepo scaffold, lint, tests and CI | CI passes on the main branch |
| M1 Rules engine | The engine for every Must rule, the simulator, and the invariant and leak tests | 10,000 simulated games across 4 to 16 players all finish, with no invariant failures |
| M2 Playable build | Server, castle and phone views, auto-host, escape hatch and bot players | A 6-player game (1 human, 5 bots) runs start to finish, and 4-player and 12-player bot games finish |
| M3 First playtest | Hosting for a real game night | The success criteria above |
| M4 Polish | Should items, chosen from M3 feedback | Decided after M3 |
| M5 Extras | Could items | Optional |

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| 4 to 5 player games feel thin | The game is over in two votes | Faithful-clue missions, best-of-three play, and recommending 6 or more |
| The auto-host stalls | A phase can't move on because a phone is off | A timer and a default on every input, plus the escape hatch |
| The creator misuses the escape hatch | Players stop trusting the game | No action reveals secrets, and the castle announces every use |
| Night tells | Traitors are spotted by how they use their phones | Identical screens, a fixed 90-second night, and everyone types |
| A player proves their role with their phone | The game collapses | The forgeable "Show my card" button |
| Home Wi-Fi drops | Missed votes or picks | State held on the server, automatic rejoin, and inputs resent on reconnect |
| One person always wins the quiz | They hold the Shield every night | A mixed question bank and random tie-breaks, with more mission types later |
| Scope creep | The game never gets finished | Nothing beyond the Musts until M3 |

## Open questions

- [ ] Final name
- [ ] Is 5 minutes the right default for Round Table discussion?
- [ ] Should roles stop being revealed on banishment once the endgame starts?
- [ ] Is phones-only mode needed in v1 for 4 to 5 player games, where nobody may want to set up a TV?
- [ ] Selfies or emoji avatars?
- [ ] Where does the quiz question bank come from: written with Claude, or an openly licensed trivia set?
