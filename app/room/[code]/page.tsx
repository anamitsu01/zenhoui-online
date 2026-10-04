import GameRoom from "@/components/GameRoom";

export default async function RoomPage(props: PageProps<"/room/[code]">) {
  const { code } = await props.params;
  return (
    <div className="flex flex-1 flex-col px-4 py-8 sm:px-8">
      <GameRoom code={code.toUpperCase()} />
    </div>
  );
}
