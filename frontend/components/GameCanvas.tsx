'use client';

import dynamic from 'next/dynamic';

// Dynamic import with SSR disabled for Phaser (client-only)
const GameCanvasClient = dynamic(
  () => import('./GameCanvasClient').then(mod => mod.default),
  { ssr: false }
);

export default function GameCanvas() {
  return <GameCanvasClient />;
}
