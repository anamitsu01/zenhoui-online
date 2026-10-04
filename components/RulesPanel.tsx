import { ITEMS, RUINS_EFFECTS, TERRAIN_INFO } from "@/lib/content";

export default function RulesPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-white/10 bg-panel/80 p-4 text-sm leading-relaxed">
      <summary className="cursor-pointer text-base font-bold text-ink">ルール</summary>
      <RulesContent className="mt-3" />
    </details>
  );
}

export function RulesContent({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-3 text-white/70 ${className}`}>
      <p>
        <b className="text-ink">手番</b>: サイコロを振り、出た目の数だけ上下左右の好きな方向へ進む(何度曲がってもよく、来た道を戻ってもよい)。
        出た目はぴったり使い切る。通ったマスは自分の色になり、相手の色も上書きできる。
      </p>
      <p>
        <b className="text-ink">囲い</b>: 自分の色で囲った内側(盤面の外とつながっていない部分)は、まとめて自分の色になる。
      </p>
      <p>
        <b className="text-ink">コマ</b>: 他のコマがいるマスは通り抜けられる(色も変わる)が、そこで止まることはできない。
      </p>
      <p>
        <b className="text-ink">霧</b>: 自分のコマの周囲2マスまでが見える。一度晴れたマスは見えたまま。味方同士で視界を共有する。
      </p>
      <p>
        <b className="text-ink">得点</b>: 全員が1回ずつ動いたら1セット終了。そのときマスが一番多い陣営に1点、さらにその陣営が支配しているフラッグ1本につき+1点。
        同数なら誰にも入らない。
      </p>
      <p>
        <b className="text-ink">勝利</b>: 目標点に先に到達するか、塗れるマスの規定割合以上を1色で塗ったら即勝利。
      </p>
      <p>
        <b className="text-ink">手番の順番</b>: チーム戦は青1→赤1→青2→赤2…と交互。個人戦は参加順。
      </p>

      <details className="rounded-lg bg-white/[0.03] p-3">
        <summary className="cursor-pointer font-semibold text-ink">地形</summary>
        <ul className="mt-2 space-y-1">
          {TERRAIN_INFO.map((t) => (
            <li key={t.name}>
              {t.icon} <b className="text-ink">{t.name}</b>: {t.description}
            </li>
          ))}
        </ul>
      </details>
      <details className="rounded-lg bg-white/[0.03] p-3">
        <summary className="cursor-pointer font-semibold text-ink">遺跡の効果(サイコロで決定)</summary>
        <ul className="mt-2 space-y-1">
          {RUINS_EFFECTS.map((r) => (
            <li key={r.roll}>
              <b className="text-ink">
                {r.roll}. {r.name}
              </b>
              : {r.description}
            </li>
          ))}
        </ul>
      </details>
      <details className="rounded-lg bg-white/[0.03] p-3">
        <summary className="cursor-pointer font-semibold text-ink">アイテム(手番の最初、サイコロを振る前に使う。最大3個)</summary>
        <ul className="mt-2 space-y-1">
          {ITEMS.map((i) => (
            <li key={i.id}>
              {i.icon} <b className="text-ink">{i.name}</b>: {i.description}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
