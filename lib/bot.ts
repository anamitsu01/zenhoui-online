import { ITEM_BY_ID } from "./content";
import { applyItem, buildBridge, chooseDie, discardItem, endMove, legalSteps, neighbors4, roll, step, takeCaveItem } from "./gameEngine";
import type { RoomState } from "./types";


function rand<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

/**
 * One simple, somewhat random action for the bot whose turn it is. Bots play
 * on the server's full state but don't aim for anything hidden — they just
 * wander, preferring cells that aren't already theirs.
 */
export function botAct(room: RoomState, botId: string): RoomState {
  const turn = room.turn!;
  const bot = room.players.find((p) => p.id === botId)!;

  if (turn.stage === "start") {
    if (!bot.cave) {
      const index = bot.items.findIndex((it) => ITEM_BY_ID[it].target !== "riverCell");
      if (index >= 0 && Math.random() < 0.5) {
        const def = ITEM_BY_ID[bot.items[index]];
        const enemies = room.players.filter((p) => p.color !== bot.color);
        const own = room.cells.flatMap((c, i) => (c.o === bot.color && !room.players.some((p) => p.pos === i) ? [i] : []));
        const target =
          def.target === "enemy"
            ? rand(enemies).id
            : def.target === "ownCell"
              ? rand(own)
              : def.target === "cell"
                ? Math.floor(Math.random() * room.cells.length)
                : def.target === "seenCell"
                  ? rand(room.cells.flatMap((c, i) => (c.t === "plain" && !room.players.some((p) => p.pos === i) ? [i] : [])))
                  : null;
        try {
          return applyItem(room, botId, index, target);
        } catch {
          // fall through and just roll
        }
      }
      const river = neighbors4(room.size, bot.pos).find((c) => room.cells[c].t === "river");
      if (river !== undefined && Math.random() < 0.25) return buildBridge(room, botId, river);
    }
    return roll(room, botId);
  }

  if (turn.stage === "bonus") return roll(room, botId);
  if (turn.stage === "chooseDie") return chooseDie(room, botId, turn.dice.map((d, i) => [d, i]).sort((a, b) => b[0] - a[0]).slice(0, turn.dice.length - 1).map(([, i]) => i));
  if (turn.stage === "caveItem") return takeCaveItem(room, botId, 0);
  if (turn.stage === "discard") return discardItem(room, botId, Math.floor(Math.random() * bot.items.length));

  const options = legalSteps(room, bot, turn);
  if (!options.length) return endMove(room, botId, false);
  const fresh = options.filter((c) => room.cells[c].o !== bot.color);
  return step(room, botId, rand(fresh.length && Math.random() < 0.8 ? fresh : options));
}
