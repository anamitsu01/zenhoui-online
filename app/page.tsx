"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket, saveIdentity } from "@/lib/socketClient";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"idle" | "create" | "join">("idle");
  const [error, setError] = useState<string | null>(null);

  function createRoom() {
    if (!name.trim()) {
      setError("お名前を入力してください");
      return;
    }
    setMode("create");
    setError(null);
    const socket = getSocket();
    socket.emit("room:create", { name: name.trim() }, (res) => {
      setMode("idle");
      if (res.ok) {
        saveIdentity(res.data.room.code, { playerId: res.data.playerId, name: name.trim() });
        router.push(`/room/${res.data.room.code}`);
      } else {
        setError(res.error);
      }
    });
  }

  function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("部屋コードを入力してください");
      return;
    }
    router.push(`/room/${code}`);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20">
      <div className="w-full max-w-md text-center">
        <p className="mb-3 text-xs tracking-[0.5em] text-lamp/80">OMNIDIRECTIONAL SUGOROKU</p>
        <h1 className="mb-4 text-5xl font-black tracking-widest text-ink">
          全方位<span className="text-lamp">すごろく</span>
        </h1>
        <p className="mb-10 text-sm leading-relaxed text-white/55">
          サイコロの目の数だけ、好きな方向へ。通った道は自分の色に、囲めば陣地に。
          <br />
          霧に隠れた世界を探索し、フラッグを奪い合え。
          <br />
          <span className="text-white/40">2〜8人・チーム戦／個人戦</span>
        </p>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ニックネーム"
          maxLength={24}
          className="mb-6 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-center text-lg"
        />

        <button
          onClick={createRoom}
          disabled={mode === "create"}
          className="mb-4 w-full rounded-full bg-lamp px-8 py-3 font-bold text-black hover:bg-lamp-light disabled:opacity-40"
        >
          {mode === "create" ? "作成中..." : "部屋を作る"}
        </button>

        <div className="mb-4 flex items-center gap-3 text-white/30">
          <span className="h-px flex-1 bg-white/10" />
          または
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && joinRoom()}
            placeholder="部屋コード"
            maxLength={5}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-center text-lg uppercase tracking-widest"
          />
          <button
            onClick={joinRoom}
            className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 font-semibold hover:bg-white/10"
          >
            参加
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
