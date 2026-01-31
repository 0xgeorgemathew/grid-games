import GameCanvas from '@/components/GameCanvas';

export default function Home() {
  return (
    <div className="min-h-screen bg-tron-black flex items-center justify-center p-8">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-4xl font-bold text-tron-cyan text-glow">Grid Games</h1>
        <GameCanvas />
        <p className="text-sm text-tron-white-dim">Click a tile to select it</p>
      </div>
    </div>
  );
}
