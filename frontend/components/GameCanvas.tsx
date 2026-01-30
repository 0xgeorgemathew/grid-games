'use client';

import { useEffect, useRef } from 'react';

export default function GameCanvas() {
  const gameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function initPhaser() {
      const Phaser = (await import('phaser')).default;

      const config = {
        type: Phaser.AUTO,
        parent: gameRef.current,
        width: 800,
        height: 600,
        physics: { default: 'arcade', arcade: { gravity: { y: 300 } } },
        scene: [] // Import scenes here later
      };

      new Phaser.Game(config);
    }
    initPhaser();
  }, []);

  return <div ref={gameRef} className="rounded-lg overflow-hidden border border-accent" />;
}
