import { CARD_INVENTORY, CARD_VALUES, abilityForValue } from '@cabo/shared/client';
import { Link } from 'react-router';
import { CardBack, CardFace } from '../components/Card';

const ABILITY_TEXT = { peek: 'Peek', spy: 'Spy', swap: 'Swap' } as const;

export function RulesPage() {
  return (
    <main className="page narrow rules" id="main">
      <h1>How to play Cabo</h1>
      <p className="muted">
        This page explains the rules exactly as this app implements them, following the publisher’s current standard rules for 2–5 players. It is an
        unofficial fan implementation, not affiliated with or endorsed by the publisher.
      </p>

      <h2>Goal</h2>
      <p>
        Finish each round with the lowest total of card values in front of you. Over a game, the player with the lowest score wins. The catch: you only
        ever see your cards when the rules let you, so you have to remember them.
      </p>

      <h2>The deck</h2>
      <p>52 cards numbered 0 to 13. Each card is worth its number.</p>
      <div className="rules-cards" aria-hidden="true">
        <CardFace value={0} size="mini" />
        <CardFace value={5} size="mini" />
        <CardFace value={7} size="mini" />
        <CardFace value={9} size="mini" />
        <CardFace value={11} size="mini" />
        <CardFace value={13} size="mini" />
        <CardBack size="mini" />
      </div>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">Card inventory</caption>
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">Copies</th>
              <th scope="col">Ability</th>
            </tr>
          </thead>
          <tbody>
            {CARD_VALUES.map((v) => {
              const a = abilityForValue(v);
              return (
                <tr key={v}>
                  <td>{v}</td>
                  <td>{CARD_INVENTORY[v]}</td>
                  <td>{a ? ABILITY_TEXT[a] : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Setting up a round</h2>
      <ol>
        <li>Everyone gets four face-down cards in a 2 × 2 grid. Cards keep their position unless a move changes them.</li>
        <li>The rest form the draw pile; its top card is turned face up to start the discard pile.</li>
        <li>
          Each player privately looks at <strong>two</strong> of their own cards, then confirms. After that, they are hidden again — memorise them!
        </li>
        <li>Round 1 starts with a random player. Afterwards, the winner of the previous round goes first. Play goes clockwise (seat order).</li>
      </ol>

      <h2>Your turn</h2>
      <p>Choose exactly one:</p>
      <ul>
        <li>
          <strong>Draw from the draw pile.</strong> Only you see the card. Then either put it in your grid in place of one of your cards (the old card goes
          face up on the discard pile), discard it, use its ability (if it is a 7–12), or use it to match (below).
        </li>
        <li>
          <strong>Take the top discard.</strong> Everyone sees what you take. You must put it in your grid in place of one card (or use it to match). A card
          taken from the discard pile never uses its ability.
        </li>
        <li>
          <strong>Call Cabo</strong> instead of drawing (see below).
        </li>
      </ul>

      <h2>Card abilities</h2>
      <p>Abilities only work on a card you just drew from the draw pile and then discard. Using them is optional.</p>
      <ul>
        <li>
          <strong>7 or 8 — Peek:</strong> look at one of your own cards.
        </li>
        <li>
          <strong>9 or 10 — Spy:</strong> look at one card belonging to another player.
        </li>
        <li>
          <strong>11 or 12 — Swap:</strong> exchange one of your cards with one of another player’s cards, without looking at either.
        </li>
      </ul>
      <p>The looked-at card is shown only to you until you press “Done”, then it is hidden again. Everyone else sees which card you looked at, not its value.</p>

      <h2>Matching</h2>
      <p>
        With the card you drew or took, you may try to replace <strong>2, 3 or 4</strong> of your own cards that you believe have the same value. The drawn
        card itself does not need to match.
      </p>
      <ul>
        <li>
          <strong>If they all match:</strong> they are discarded, your card takes the place of the first one you selected, and the other places stay empty
          for the rest of the round. You now have fewer cards.
        </li>
        <li>
          <strong>If any differ:</strong> the selected cards are shown to everyone and returned face down to their places, your drawn card is discarded, and
          your turn ends.
        </li>
      </ul>

      <h2>Calling Cabo</h2>
      <p>
        At the start of your turn, if you think you have the lowest total, call Cabo instead of drawing. Every other player then gets exactly one more turn,
        and the round ends. Only one player can call Cabo per round. The caller’s cards can still be spied on and swapped during those final turns.
      </p>
      <p>If the draw pile runs out, the top discard stays and the rest of the discard pile is shuffled into a new draw pile.</p>

      <h2>Scoring a round</h2>
      <ul>
        <li>All cards are revealed and totalled.</li>
        <li>The player with the lowest total scores 0; everyone else scores their total.</li>
        <li>
          If the Cabo caller does not have the lowest total, they score their total <strong>plus 5</strong>.
        </li>
        <li>If the caller ties for the lowest total, the caller scores 0 and the other tied players score their totals.</li>
        <li>If players tie for the lowest total and none of them called Cabo, they all score 0.</li>
        <li>
          <strong>Shooting the Moon:</strong> ending a round with exactly two 12s and both 13s scores 0, and every other player scores 50 — no matter who
          called Cabo.
        </li>
      </ul>

      <h2>Full game (default)</h2>
      <ul>
        <li>Round scores add up.</li>
        <li>
          If your total lands on <strong>exactly 100</strong>, it drops to 50. This happens at most once per player per game.
        </li>
        <li>When any player’s total goes over 100, the game ends. The lowest total wins; tied players share the win.</li>
      </ul>

      <h2>Quick game</h2>
      <p>
        The publisher’s quick-play option is “best of 3 rounds”. In this app, each round’s winner (the player who scores 0 as lowest, the successful caller, or
        the moon shooter; players tied without the caller each count) earns a round win. The game ends after three rounds, or earlier once someone can no
        longer be caught. Most round wins wins the game; ties are broken by the lowest points over the rounds played, and remaining ties share the win. The
        100-point reset does not apply in quick games.
      </p>

      <p style={{ marginTop: 24 }}>
        <Link to="/">Back to home</Link>
      </p>
    </main>
  );
}
