# Playtest checklist (room creator)

One page for game night. You are also a player, so everything here is something you do _before_ the
game or _after_ it. Success criteria are from [`SPEC.md`](SPEC.md#objectives-and-success-criteria):
M3 passes after **3 games in a row** meeting them. Keep one scorecard per game (bottom of this page).

## 0. Once, by hand (days before)

- [ ] Install `cloudflared` on the laptop and run `cloudflared --version` ([README, "Game night"](../README.md#game-night)).
- [ ] Print this page, one scorecard per game (3), and a pen. Decide who asks the debrief questions.
- [ ] Run the dry run in section 1 on the real tunnel at least once before the night.

## 1. Setup (30 minutes before guests)

- [ ] Laptop plugged in, sleep off, on the home Wi-Fi, TV connected. One-time: `cloudflared` is installed.
- [ ] `cd midnight-table && git pull && pnpm install && pnpm start`. Wait for the box with the
      `https://….trycloudflare.com` address. Leave that terminal open and do not restart it mid-game.
- [ ] Open **that https address** in the laptop browser (not `localhost`), create a room, put the
      castle view (`/castle/CODE`) full screen on the TV.
- [ ] **Dry run with your own phone** (this is the first time the real tunnel is used, so treat
      anything odd as a finding): scan the QR, join, add 2 bots, start. Check the QR opens an https
      page, the phone screen **stays awake** for 3 minutes untouched, and "Reconnecting…" does not
      flash. Then reload the page: you should land back in your seat in under 5 s.
- [ ] Tell guests: use the camera to scan the QR; no install; pick a name and a face. Phones on the
      same Wi-Fi are fine, mobile data also works (the tunnel is public).
- [ ] Do not open `data/rooms/*.jsonl` or the server terminal during a game: the log holds the seed,
      and the seed decides every role.

## 2. Starting

- 6 or more players is the real game (4–5 is a quick best-of-three; say so up front).
- When everyone is seated and has a face, press **Start with N** on your phone. Add bots from the
  lobby only if you are short, and say which seats are bots.
- If a guest's phone dies or they join late in the lobby, they re-scan the QR. Mid-game, the same
  phone re-scans and rejoins by itself; a _new_ phone cannot take a seat.

## 3. Escape-hatch menu (the **Host** button, top right of your phone)

| Button                     | Use it when                                            | Costs                        |
| -------------------------- | ------------------------------------------------------ | ---------------------------- |
| Pause / Resume             | Someone must step away, or something is confused       | Announced on the castle      |
| Add 60 seconds             | A phase timer ran out while people were typing         | Announced                    |
| Re-run the current vote    | A phone failed at the moment of a vote                 | Clears all ballots, re-votes |
| Drop a disconnected player | A phone is gone for good; their seat goes to autopilot | Announced                    |
| End the game               | The night is over, or the game is broken               | Ends it for everyone         |

None of these reveals a role. **Tally every use on the scorecard with the reason**; the target is at
most one per game. If you reach for it twice, that is a finding, not a failure.

## 4. What to watch (against the success criteria)

| Criterion (target)                                 | Watch for, and write down                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Games finish** (3 in a row, no restart)          | Start and end time. Any `Server exited…` line in the terminal, any "Reconnecting…" that lasts more than 10 s. A restart of `pnpm start` resets the count.                                         |
| **No host needed** (menu used ≤ 1 per game)        | Each menu press and why. Any moment the whole table waits and looks at you.                                                                                                                       |
| **Secrets hold** (nobody read a role off a phone)  | Phones tilted toward a neighbour, people showing a card, comments like "your screen looked…". At night: who types a lot, who is fast, who looks up.                                               |
| **It's fun** (rematch asked in 2 of 3)             | Laughter at reveals, side talk during the vote, anyone checking a phone for other things, who wants "one more".                                                                                   |
| **It's robust** (lock or refresh rejoins in < 5 s) | Ask one guest each game to lock their phone for a minute mid-discussion, then unlock. Count seconds until their screen is current. Note anyone whose screen went to sleep on its own (Wake Lock). |

Also note (from the spec's risks): 4–5 player games feeling thin; the same person winning the Shield
every night; a quiz question anyone calls wrong or arguable (write the exact question down); a phase
where nobody knew what to do.

## 5. Debrief (5 minutes, right after the final reveal, before rematch talk)

Ask in this order. Ask the secrecy questions **first and one at a time**, so earlier answers don't
colour later ones; write answers down verbatim.

1. "Did anyone read, or think they read, someone's role off their phone or screen? How?"
2. "At night, did you notice anything about how anyone used their phone?"
3. "Did you tap Show my card, or ask anyone to? Did it convince you of anything?"
4. "When did the game stall, confuse you, or feel slow? Did you want the host to step in?"
5. "Which question or vote felt unfair, wrong or arguable?"
6. "Fun, 1 to 5, by show of hands. Longest or dullest part?"
7. **Rematch:** "Do you want to play again right now?" Count hands, and write down whether _they_ asked
   or you did. Then: "Same group again next week?"

Afterwards, go through section 4 and mark each criterion met or not met. Fix nothing during the night
except a broken question; everything else goes on the M4 list, chosen from what you wrote here.

## Scorecard (copy per game)

```
Game #__  players __ (bots __)  start __:__  end __:__  winner: Faithful / Traitor
Restarts of pnpm start: __   "Server exited" lines: __   longest "Reconnecting…": __ s
Host-menu uses: __  (reasons: ______________________)
Lock/unlock rejoin time: __ s   Phones that slept by themselves: __
Role read off a phone (Q1/Q2): none / ______________
Rematch asked by: table / creator / nobody      Fun (1–5): __
Question complaints: ______________________   Other findings: ______________
```
