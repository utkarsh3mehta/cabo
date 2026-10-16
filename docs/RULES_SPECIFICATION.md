# Cabo Online — Rules Specification

This document is the authoritative rules baseline for the game engine in
`packages/game-engine`. The rules page in the web app (`/rules`) is a
player-facing summary of this document. If the two ever disagree, this
document and the engine tests win, and the rules page is the defect.

Research date: 2026-10-16.

---

## 1. Selected edition and sources

**Baseline:** the current publisher's *Standard Rules of Cabo* for 2–5 players,
published by Shareful Games, LLC (© 2025) at
<https://www.cabogame.com/how-to-play>, together with the single-deck product
page <https://www.cabogame.com/buy-cabo/p/cabo-card-game>.

Only this baseline is implemented. No house-rule editor is exposed.

| # | Source | Role | What it contributed |
|---|--------|------|---------------------|
| S1 | cabogame.com — *Standard Rules of Cabo* (Shareful Games, 2025) | **Primary, normative** | Setup, turns, matching, choice-card behaviour, Cabo, scoring, ties, penalty (5), Shooting the Moon, score reset, game end, Quick Play label |
| S2 | cabogame.com — CABO Card Game product page | **Primary, normative** | 52 cards, numbered 0–13, 2–5 players with one deck |
| S3 | cabogame.com rules-card photo (`cabo-rules-cards.jpg`) | Primary, supporting | Confirms printed rules card 1 of 2 matches S1 word-for-word; choice-card legend is "on reverse" (not photographed) |
| S4 | Original 2010 rules (Eventide Games), German translation hosted by licensee Smiling Monster Games (`SMG-Cabo-DE.pdf`) | Supporting, same rules family | Confirms tie handling, matching procedure, abilities only from the draw pile, swap without looking |
| S5 | *Cabo – KSR* short rules for the Smiling Monster edition (Spielerei / H@LL9000, 2018) | Secondary | **Explicit per-value inventory** and value→ability mapping; Cabo caller's cards remain swappable; only one Cabo call per round |
| S6 | Wikipedia, *Cabo (game)* | Secondary | 52 cards; 7–8 Peek, 9–10 Spy, 11–12 Swap for the base game; edition history |
| S7 | RulesPal / Bézier Games 2nd-edition rulebook (2019) | **Comparison only — not implemented** | Used only to list differences (§12) and to cross-check the ability mapping |
| S8 | `cowdevs/cabo` (open-source Godot implementation) | Corroboration only | Encodes the same 2/4/2 inventory |

## 2. Deck inventory

52 cards. Every card's score equals its printed number.

| Value | Copies | Score | Choice ability |
|------:|-------:|------:|----------------|
| 0  | 2 | 0  | — |
| 1  | 4 | 1  | — |
| 2  | 4 | 2  | — |
| 3  | 4 | 3  | — |
| 4  | 4 | 4  | — |
| 5  | 4 | 5  | — |
| 6  | 4 | 6  | — |
| 7  | 4 | 7  | **Peek** |
| 8  | 4 | 8  | **Peek** |
| 9  | 4 | 9  | **Spy** |
| 10 | 4 | 10 | **Spy** |
| 11 | 4 | 11 | **Swap** |
| 12 | 4 | 12 | **Swap** |
| 13 | 2 | 13 | — |
| **Total** | **52** | | 8 Peek, 8 Spy, 8 Swap |

**Verification status.**

- *Total of 52 cards, values 0–13, choice cards exist*: confirmed by the
  current publisher (S2, S1).
- *Exactly two 13s*: implied by the current publisher's Shooting the Moon
  wording ("two 12s and **both** 13s", S1) and stated by S5.
- *Two 0s and four each of 1–12*: stated explicitly by S5. It is also the only
  split consistent with 52 cards, two 13s and four 12s (S1 requires at least
  two 12s). Corroborated by S8. **The current publisher's own published text
  does not list per-value counts**, so this row of the table counts as
  corroborated, not as confirmed by the publisher. See §13.
- *Ability mapping 7–8 Peek, 9–10 Spy, 11–12 Swap*: stated by S5 and S6 for the
  base game and identical in S7. The current publisher's legend is printed on
  the reverse of its rules card (S3), which is not published online.
  Corroborated, not confirmed from the publisher's text. See §13.
- *No other card-specific exceptions*: none of S1–S6 mention any. 0 and 13 are
  plain scoring cards.

The inventory is defined in one place (`packages/shared/src/cards.ts`) and
covered by a deck-integrity test, so a correction is a one-line change.

## 3. Setup

1. Shuffle all 52 cards using the server's random source.
2. Deal 4 cards face down to every participant (bots included). In the app the
   four cards form a 2 × 2 grid of **slots** numbered 0–3: 0 top-left,
   1 top-right, 2 bottom-left, 3 bottom-right. Cards never change slots except
   through the moves in §4–§6.
3. The rest of the cards form the face-down draw pile. Turn its top card face
   up to start the discard pile.
4. **Initial inspection.** Before the first turn of every round, each player
   privately looks at exactly 2 of their own 4 cards, chosen by the player.
   They see those values until they confirm they are ready. After that the
   cards are hidden again. The round's first turn starts when every player
   has confirmed.
5. **Starting player.**
   - Round 1: chosen at random by the server (the rules say "decide who goes
     first").
   - Later rounds: the previous round's winner goes first (S1). If the
     previous round had several winners (§7.3), the first of them clockwise
     from the previous round's starting player, that player included.
   - The publisher's "the loser shuffles and deals" has no online equivalent.
     The server always shuffles.

## 4. Turns

Play goes clockwise in seat order. On their turn the active player must choose
exactly one of these:

### 4.1 Draw from the draw pile
The player takes the top card and is the only one who sees it. Then they must
do exactly one of:

- **(a) Replace.** Put the drawn card face down into one of their occupied
  slots. The card that was there goes face up onto the discard pile.
- **(b) Use its ability** (only if the drawn card is 7–12). The drawn card goes
  face up onto the discard pile, then the player carries out its action (§5).
- **(c) Discard.** Put the drawn card face up onto the discard pile without
  using it.
- **(d) Match.** Replace a set of 2, 3 or 4 of their own cards with the drawn
  card (§6).

The turn then ends.

### 4.2 Take the top discard
The player takes the face-up top card of the discard pile. They must then either
**replace** one occupied slot with it (the old card goes face up onto the
discard pile), or **match** with it (§6). The taken card goes into the layout
face down. A card taken from the discard pile:

- may not be put straight back without being used;
- never activates its ability (S1, S4).

The turn then ends.

### 4.3 Call Cabo
Instead of drawing, the active player may call Cabo (§7.1). The rules forbid
calling out of turn, and the server enforces that.

## 5. Choice-card abilities

An ability can only be used on a card the player has just drawn from the
**draw pile** and discarded. Using it is always optional (§4.1 c).

| Ability | Target | Effect |
|---------|--------|--------|
| **Peek** (7, 8) | One of the player's own occupied slots | That card's value is shown only to the player until they confirm. Then it is hidden again. |
| **Spy** (9, 10) | One occupied slot of any other player | That card's value is shown only to the player until they confirm. Then it is hidden again. |
| **Swap** (11, 12) | One own occupied slot and one occupied slot of another player | The two cards trade places. Nobody sees either value. |

All players learn *that* a Peek, Spy or Swap happened and which slot(s) it
touched. Only the acting player learns a peeked or spied value.

## 6. Matching (2-, 3- or 4-of-a-kind)

Matching uses a card held after either kind of draw (§4.1 d, §4.2).

1. The player picks 2–4 of their own occupied slots that they claim all hold
   the same value. The value of the held card does not matter: matching is
   among the player's own cards.
2. The server reveals the selected cards to **all** players.
3. **Success** (all selected values are equal):
   - all selected cards go face up onto the discard pile;
   - the held card goes face down into the **first selected** slot;
   - the other selected slots become **empty** and stay empty for the rest of
     the round. Empty slots are not refilled, moved or compacted.
   - The player continues the round with 3, 2 or 1 cards.
4. **Failure** (any selected value differs from the others):
   - the selected cards are shown to all players and then go back face down
     into their **original slots**;
   - the held card goes face up onto the discard pile (when it came from the
     discard pile, this returns it there);
   - the turn is lost (it ends).
5. Choosing a single slot is an ordinary replacement, not a match.

## 7. Calling Cabo and ending a round

### 7.1 Calling Cabo
- Only the active player may call, and only at the start of their turn,
  before drawing.
- Calling ends that player's turn.
- Every other player then gets **exactly one** more turn, in clockwise
  order. The round ends right after the last of those turns.
- Only one Cabo call per round. Once Cabo has been called, nobody else can
  call it that round (S5).
- The caller's cards stay valid targets for Spy and Swap during the final
  turns (S5; S1 has no exception).
- A player may call Cabo on any turn of a round, including the first.
- A round only ends through a Cabo call. An empty draw pile is replenished
  (§8) and does not end the round.

### 7.2 Round scoring
At round end every remaining card is revealed to everyone. A player's
**hand total** is the sum of their remaining cards.

1. **Shooting the Moon** is checked first. If a player's remaining cards are
   exactly {12, 12, 13, 13} (four cards, nothing else), that player scores
   **0** and **every other player scores 50**, whoever called Cabo. No other
   penalty applies that round. Only one player can hold both 13s, so at most
   one player can shoot the moon.
2. Otherwise, let *L* be the set of players with the lowest hand total.
   - **The caller is in *L*** (alone or tied): the caller scores **0**. Any
     other player in *L* scores their hand total, because the caller wins the
     tie (S1: "the player who risked calling Cabo receives 0 points"; S4
     agrees).
   - **The caller is not in *L***: every player in *L* scores **0** (S1: "if
     neither tied player called Cabo they each receive 0 points"). The
     caller scores their hand total **+ 5**.
   - Everyone else scores their hand total.

### 7.3 Round winners
The round winners are exactly the players who score 0 *as a winner* under
§7.2: the moon shooter, or the caller when in *L*, or every member of *L*
otherwise. A non-winner whose hand total is 0 also scores 0, but is not a
winner. Winners decide who starts the next round (§3.5) and who earns
quick-game round wins (§9).

### 7.4 Cumulative score and score reset (full game)
After each round, every player's cumulative score increases by their round
score. If a player's new cumulative score is **exactly 100** and they have not
used their reset this game, it becomes **50** and their reset counts as used.
The reset happens automatically and at most once per player per game. A second
landing on exactly 100 stays at 100.

## 8. Draw-pile exhaustion

When a player draws from an empty draw pile, the top card of the discard pile
stays face up as the new discard pile and the rest of the discard pile is
shuffled into a new draw pile (S1). Everyone is told a reshuffle happened.
With at most 5 × 4 = 20 cards in layouts and 1 card in hand, at least 31 cards
are always available, so a reshuffle can always produce a draw pile.

## 9. Game modes

### 9.1 Full game (default)
Rounds continue until, after a round, at least one player's cumulative score
is **greater than 100** (exactly 100 does not end the game). The player or
players with the **lowest cumulative score** win. The publisher names no
tie-breaker, so tied players **share** the win (§13).

### 9.2 Quick game
The publisher's Quick Play option reads only "Best of 3 rounds wins!" (S1).
This app implements it as follows.

- Card mechanics and round scoring are exactly as in §3–§8.
- Each round winner (§7.3) earns **one round win**. Co-winners each earn one.
- The match ends after round 3, or earlier as soon as one player has more round
  wins than any other player could still reach in the remaining rounds (the
  match is clinched).
- **Winner:** the player with the most round wins. Ties go to the lowest
  cumulative points across the rounds played (round scores including penalties
  and Shooting the Moon). Players still tied **share** the win.
- The 100-point reset (§7.4) and the >100 game end (§9.1) do not apply to
  quick games, because the match length is fixed.

## 10. Resolved edge cases

| # | Situation | Resolution | Basis |
|---|-----------|------------|-------|
| E1 | A card taken from the discard pile is a 7–12 | No ability. It can only replace or match. | S1, S4 |
| E2 | A player takes the discard and wants to put it back | Not allowed. It must replace or match. | S1 ("replace one of their own cards") |
| E3 | Choice card drawn from the draw pile kept in the layout | Allowed. It scores its number and has no ability while in the layout. | S1 (b), S4 |
| E4 | Ability targets an empty slot | Rejected. Targets must be occupied slots. | Engine invariant |
| E5 | Swap with the Cabo caller during final turns | Allowed | S5; S1 has no exception |
| E6 | Spy or Swap targeting yourself, or Peek targeting someone else | Rejected | S1 definitions |
| E7 | Second Cabo call in the same round | Rejected | §7.1, S5 |
| E8 | Calling Cabo after drawing | Rejected ("instead of drawing") | S1 |
| E9 | Failed match using the taken discard | The card goes back onto the discard pile and the turn ends | S1 ("the drawn card discarded") |
| E10 | Failed match of 3+ cards | Same procedure as 2 cards. No penalty card (that is a 2nd-edition rule). | S1 |
| E11 | Match selection includes the same slot twice, or an empty slot | Rejected | Engine invariant |
| E12 | Tie for lowest that includes the caller and others | Caller 0, other tied players score their hand total | S1, S4 |
| E13 | Tie for lowest without the caller | All tied players 0; caller hand + 5 | S1, S4 |
| E14 | Shooting the Moon while someone else called Cabo | Shooter 0, all others 50, no +5 | S1 ("regardless of who called Cabo") |
| E15 | Moon shooter also called Cabo | Shooter 0, all others 50 | S1 |
| E16 | Score lands on exactly 100 a second time | Stays 100 and the game continues | S1 ("once per player per game") |
| E17 | Several players exceed 100 after the same round | Game ends. Lowest cumulative score wins, ties share. | S1, §13 |
| E18 | Moon penalty pushes a player to exactly 100 | Reset applies if unused | §7.4 applied uniformly |
| E19 | Next-round starter when the round had several winners | First winner clockwise from the previous starter, that player included | Implementation decision |
| E20 | Initial inspection count | Exactly 2 distinct own slots, chosen by the player | S1 |
| E21 | Draw pile empty when drawing | Reshuffle per §8, then draw | S1 |
| E22 | Hand size can never grow | True under S1 (failed matches add no cards), so layouts have ≤ 4 slots | S1 |
| E23 | Disconnected player's turn | The game waits. The host may hand the seat to a bot after the grace period. | Product policy (ARCHITECTURE.md) |

## 11. What players see (hidden information)

- Layout cards are always face down during a round. Nobody, including the
  owner, sees a layout card unless a rule shows it:
  - the owner during initial inspection, until they confirm;
  - the owner (Peek) or the actor (Spy) during that ability, until they confirm;
  - everyone, briefly, for cards revealed by a match attempt;
  - everyone at round end.
- A card drawn from the draw pile is shown only to the drawer until it is
  discarded.
- The top of the discard pile is public.
- The server never sends a client a hidden value it is not entitled to see,
  and never sends stable card identifiers for face-down cards, because those
  would let clients track cards across reshuffles. See ARCHITECTURE.md §4.

## 12. Differences from the 2019 second edition (not implemented)

| Topic | 2nd edition (S7) | Implemented baseline (S1) |
|-------|------------------|---------------------------|
| Players | 2–4 | 2–5 |
| Failed-Cabo penalty | +10 | **+5** |
| Ties including the caller | Caller scores 0 | Caller scores 0 (same) |
| Failed match | Cards stay face up and the drawn card is added to the line. 3+ cards draw an extra penalty card. | Cards are shown, go back face down, and the drawn card is discarded |
| Card taken from discard | Placed face up | Placed face down |
| Round end | Cabo **or** draw pile depleted | Cabo only. The draw pile is reshuffled. |
| Special hand | "Kamikaze", exactly 12-12-13-13 | "Shooting the Moon", two 12s and both 13s (same effect) |
| Next starter | Lowest round score, ties closest to previous starter | Round winner |
| Final tie-break | Lowest last-round score | Not specified (shared win) |
| Score reset | Once per player per game | Once per player per game (same) |

## 13. Unconfirmed points and interpretations

1. **Per-value card counts** (2×0, 4×1–12, 2×13) and the **value→ability
   mapping** are corroborated by several independent sources (S5, S6, S7, S8)
   and are consistent with every statement the publisher makes. They are not
   confirmed by text the current publisher has published. **Before calling the
   rules baseline final, someone should check them against a physical
   2025 Shareful Games deck.** A correction only changes `CARD_INVENTORY` and
   `abilityForValue` in `packages/shared/src/cards.ts`.
2. **Final-standings ties** (full game): the publisher gives no tie-breaker.
   Tied players share the win. The 2010 original (most Cabo calls) and the
   2nd edition (lowest last-round score) tie-breakers are not imported.
3. **Quick Play** ("Best of 3 rounds wins!") is interpreted as in §9.2.
4. **Shooting the Moon** is read as "remaining cards are exactly 12, 12, 13,
   13". Under S1 a player can never hold more than 4 cards, so "two 12s and
   both 13s" means exactly those four cards.
5. **Where the held card goes after a successful match**: S1 says the cards
   "may be replaced with one card" without naming a slot. The app puts it in
   the first selected slot.
6. **The caller tied with others**: S1 gives the caller 0 and does not spell
   out what the other tied players score. They score their hand total
   (consistent with S1's "everyone else receives the total points of their
   hand", and with S4's "the Cabo caller wins").
