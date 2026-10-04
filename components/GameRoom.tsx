"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getSocket, loadIdentity, saveIdentity, clearIdentity } from "@/lib/socketClient";
import type { ClientToServerEvents } from "@/lib/socketEvents";
import type { RoomSettings, RoomState } from "@/lib/types";
import { TEST_ROOM_CODE } from "@/lib/types";
import Lobby from "./Lobby";
import GameBoard from "./GameBoard";
import ConfirmDialog from "./ConfirmDialog";
import { RulesContent } from "./RulesPanel";

type ConnState = "connecting" | "needs-name" | "in-room" | "not-found";

export default function GameRoom({ code }: { code: string }) {
  const router = useRouter();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    function onUpdate(next: RoomState) {
      setRoom(next);
      setState("in-room");
    }
    function onError(message: string) {
      setJoinError(message);
    }

    // Re-associates this socket with our stored player identity. Runs on
    // every "connect" event, not just the first: mobile browsers routinely
    // drop the WebSocket when a tab is backgrounded (e.g. switching apps to
    // share the room code), and each reconnect gets a new socket.id that the
    // server has no way to link back to our player without this re-announce.
    function tryRejoin() {
      const identity = loadIdentity(code);
      if (!identity) {
        setState((prev) => (prev === "in-room" ? prev : "needs-name"));
        return;
      }
      socket.emit("room:rejoin", { code, playerId: identity.playerId }, (res) => {
        if (res.ok) {
          setPlayerId(identity.playerId);
          setRoom(res.data.room);
          setState("in-room");
        } else {
          setState("needs-name");
        }
      });
    }

    socket.on("room:update", onUpdate);
    socket.on("room:error", onError);
    socket.on("connect", tryRejoin);
    if (socket.connected) {
      tryRejoin();
    }

    return () => {
      socket.off("room:update", onUpdate);
      socket.off("room:error", onError);
      socket.off("connect", tryRejoin);
    };
  }, [code]);

  const handleJoin = useCallback(
    (name: string) => {
      const socket = getSocket();
      setJoinError(null);
      // The test code doesn't name a real room: it opens a fresh room with bots.
      if (code === TEST_ROOM_CODE) {
        socket.emit("room:createTest", { name }, (res) => {
          if (res.ok) {
            saveIdentity(res.data.room.code, { playerId: res.data.playerId, name });
            router.replace(`/room/${res.data.room.code}`);
          } else {
            setJoinError(res.error);
          }
        });
        return;
      }
      socket.emit("room:join", { code, name }, (res) => {
        if (res.ok) {
          saveIdentity(code, { playerId: res.data.playerId, name });
          setPlayerId(res.data.playerId);
          setRoom(res.data.room);
          setState("in-room");
        } else {
          setJoinError(res.error);
        }
      });
    },
    [code, router]
  );

  // Emits a game action and resolves to an error message (or null on success).
  const act = useCallback(
    <E extends keyof ClientToServerEvents>(event: E, payload: Omit<Parameters<ClientToServerEvents[E]>[0], "code">) =>
      new Promise<string | null>((resolve) => {
        const socket = getSocket();
        const emit = socket.emit as unknown as (
          ev: string,
          data: unknown,
          cb: (res: { ok: boolean; error?: string }) => void
        ) => void;
        emit.call(socket, event, { ...payload, code }, (res) => resolve(res.ok ? null : res.error ?? "エラー"));
      }),
    [code]
  );

  const handleLeave = useCallback(() => {
    const socket = getSocket();
    clearIdentity(code);
    socket.disconnect();
    socket.connect();
    router.push("/");
  }, [code, router]);

  if (state === "connecting") {
    return <Centered>接続中…</Centered>;
  }

  if (state === "needs-name") {
    return <JoinForm code={code} onJoin={handleJoin} error={joinError} />;
  }

  if (!room || !playerId) {
    return <Centered>読み込み中…</Centered>;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-lg font-black tracking-widest text-ink/80">
          全方位<span className="text-lamp">すごろく</span>
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setShowRules(true)}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            ルール
          </button>
          <button
            onClick={() => setShowLeaveConfirm(true)}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            退出する
          </button>
        </div>
      </div>

      {room.phase === "lobby" ? (
        <Lobby
          room={room}
          viewerId={playerId}
          onStart={() => act("room:start", {})}
          onSettings={(settings: Partial<RoomSettings>) => act("room:settings", { settings })}
          onTeam={(color: number, targetId?: string) => act("room:team", { color, targetId })}
          onAddBot={(color?: number) => act("room:addBot", { color })}
          onRemoveBot={(botId: string) => act("room:removeBot", { botId })}
        />
      ) : (
        <GameBoard room={room} viewerId={playerId} act={act} />
      )}

      {showRules && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 px-4 py-8"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowRules(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-white/10 bg-panel p-5 text-sm leading-relaxed sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold text-ink">ルール</h2>
              <button
                onClick={() => setShowRules(false)}
                className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:bg-white/10"
              >
                閉じる
              </button>
            </div>
            <RulesContent />
          </div>
        </div>
      )}

      {showLeaveConfirm && (
        <ConfirmDialog
          title="ゲームから退出しますか?"
          message="退出するとホーム画面に戻ります。ゲーム中の場合、あなたのコマは切断扱いになり、ホストが手番を飛ばせます。"
          confirmLabel="退出する"
          onConfirm={handleLeave}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </div>
  );
}

function JoinForm({
  code,
  onJoin,
  error,
}: {
  code: string;
  onJoin: (name: string) => void;
  error: string | null;
}) {
  const [name, setName] = useState("");
  return (
    <Centered>
      <div className="w-full max-w-sm text-center">
        <p className="mb-1 text-white/60">部屋 {code} に参加</p>
        <h1 className="mb-6 text-2xl font-bold">お名前を入力してください</h1>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onJoin(name.trim())}
          placeholder="ニックネーム"
          maxLength={24}
          className="mb-4 w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-center text-lg"
          autoFocus
        />
        <button
          onClick={() => name.trim() && onJoin(name.trim())}
          disabled={!name.trim()}
          className="w-full rounded-full bg-lamp hover:bg-lamp-light disabled:opacity-40 px-8 py-3 font-bold text-black"
        >
          参加する
        </button>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[50vh] items-center justify-center text-center">{children}</div>;
}
