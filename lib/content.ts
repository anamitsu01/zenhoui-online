import type { ItemKind } from "./types";

export type ItemTarget = "none" | "cell" | "ownCell" | "riverCell" | "enemy";

export interface ItemDef {
  id: ItemKind;
  name: string;
  icon: string;
  description: string;
  target: ItemTarget;
}

/** Items are used at the start of your turn, before rolling. */
export const ITEMS: ItemDef[] = [
  { id: "dash", name: "ダッシュ", icon: "👟", description: "このターンの移動力+5", target: "none" },
  { id: "roller", name: "ローラー", icon: "🖌️", description: "このターン、通過マスの左右1マスも塗る", target: "none" },
  { id: "bomb", name: "爆弾", icon: "💣", description: "自分の周囲8マスを自分の色にする", target: "none" },
  { id: "scout", name: "偵察", icon: "🔭", description: "好きなマスを中心に7×7の霧を晴らす", target: "cell" },
  { id: "warp", name: "ワープ", icon: "🌀", description: "自分の色の好きなマスへ移動(その後サイコロを振る)", target: "ownCell" },
  { id: "barrier", name: "防壁", icon: "🛡️", description: "指定マス周囲3×3の自分のマスを、次の得点計算まで塗り替え不可にする", target: "ownCell" },
  { id: "jam", name: "妨害", icon: "🪤", description: "相手1人の次のターンの移動力-2", target: "enemy" },
  { id: "bridgeKit", name: "橋キット", icon: "🪵", description: "自分のコマに隣接する川に、手番を使わず橋を架ける", target: "riverCell" },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i])) as Record<ItemKind, ItemDef>;

/** Ruins: roll a die when stepping on one; the effect applies to your next turn. */
export const RUINS_EFFECTS: { roll: number; name: string; description: string; icon: string; good: boolean }[] = [
  { roll: 1, name: "追い風", description: "次のターン移動力+3", icon: "💨", good: true },
  { roll: 2, name: "足かせ", description: "次のターン移動力-2", icon: "⛓️", good: false },
  { roll: 3, name: "森の加護", description: "次のターン森の追加コストを無視", icon: "🌿", good: true },
  { roll: 4, name: "色あせ", description: "次のターン、通過した相手の色を塗り替えられない", icon: "🫥", good: false },
  { roll: 5, name: "大筆", description: "次のターン、通過マスの左右1マスも塗る", icon: "🖌️", good: true },
  { roll: 6, name: "選べる運命", description: "次のターン、サイコロを3個振って好きな2個を使う", icon: "🎲", good: true },
];

/** icon "cave" is drawn with CaveIcon (no emoji reads as a cave). */
export const TERRAIN_INFO: { icon: string; name: string; description: string }[] = [
  { icon: "⛰️", name: "山", description: "通れない" },
  { icon: "🌲", name: "森", description: "入るのに移動力を1余分に使う(残り移動力が1だと入れない)" },
  { icon: "🌊", name: "川", description: "通れない。隣の川をタップすると橋を架けられる(手番の最初なら手番終了、移動中ならそこで移動終了・次のターン1回休み)" },
  { icon: "🌉", name: "橋", description: "誰でも通れる" },
  { icon: "🧊", name: "氷河", description: "通れるが、ずっと白のまま塗れない" },
  { icon: "🏛️", name: "遺跡", description: "踏むとサイコロを振り、次のターンに効果(1回で崩れる)" },
  { icon: "cave", name: "洞窟", description: "入ると次のターンから毎ターン振った目を合計し、規定値以上でアイテムを選んで脱出。超えた分だけ進める" },
  { icon: "🎁", name: "宝箱", description: "踏むとアイテムを1個獲得" },
  { icon: "🚩", name: "フラッグ", description: "自分の色にしていれば支配。見つけると全員に位置が公開される" },
];
