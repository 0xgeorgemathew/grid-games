import { Scene } from "phaser";
import { DEFAULT_GRID, COLORS, RENDER } from "../config";
import type { GridConfig } from "../config";

// Coordinate helpers (consolidated pattern)
type TileCoord = { x: number; y: number };

export class GridScene extends Scene {
  private grid!: GridConfig;
  private graphics!: Phaser.GameObjects.Graphics;
  private selectedTile: TileCoord | null = null;
  private hoveredTile: TileCoord | null = null;
  private playerPos: TileCoord;
  private player!: Phaser.GameObjects.Rectangle;

  constructor(key: string = "GridScene", grid: GridConfig = DEFAULT_GRID) {
    super(key);
    this.grid = grid;
    this.playerPos = { x: 0, y: 0 };
  }

  // Convert pointer position to grid tile
  private pointerToTile(pointer: Phaser.Input.Pointer): TileCoord {
    return {
      x: Math.floor(pointer.x / this.grid.tileSize),
      y: Math.floor(pointer.y / this.grid.tileSize),
    };
  }

  // Convert grid coordinates to pixel center of tile
  private tileToPixel(tile: TileCoord): { x: number; y: number } {
    const halfSize = this.grid.tileSize / 2;
    return {
      x: tile.x * this.grid.tileSize + halfSize,
      y: tile.y * this.grid.tileSize + halfSize,
    };
  }

  // Get pixel bounds of a tile
  private tileBounds(tile: TileCoord): { x: number; y: number; size: number } {
    return {
      x: tile.x * this.grid.tileSize,
      y: tile.y * this.grid.tileSize,
      size: this.grid.tileSize,
    };
  }

  // Compare two tile coordinates
  private isSameTile(a: TileCoord | null, b: TileCoord | null): boolean {
    return a?.x === b?.x && a?.y === b?.y;
  }

  // Draw the entire scene
  private render(): void {
    this.graphics.clear();
    this.drawGridLines();
    this.drawHighlights();
  }

  private drawGridLines(): void {
    this.graphics.lineStyle(RENDER.gridLineWidth, COLORS.gridLine);

    const maxX = this.grid.cols * this.grid.tileSize;
    const maxY = this.grid.rows * this.grid.tileSize;

    for (let i = 0; i <= this.grid.cols; i++) {
      const x = i * this.grid.tileSize;
      this.graphics.lineBetween(x, 0, x, maxY);
    }
    for (let i = 0; i <= this.grid.rows; i++) {
      const y = i * this.grid.tileSize;
      this.graphics.lineBetween(0, y, maxX, y);
    }
  }

  private drawHighlights(): void {
    if (this.hoveredTile && !this.isSameTile(this.hoveredTile, this.selectedTile)) {
      const bounds = this.tileBounds(this.hoveredTile);
      this.graphics.fillStyle(COLORS.hoverFill, RENDER.hoverAlpha);
      this.graphics.fillRect(bounds.x, bounds.y, bounds.size, bounds.size);
    }

    if (this.selectedTile) {
      const bounds = this.tileBounds(this.selectedTile);
      this.graphics.fillStyle(COLORS.selectedFill, RENDER.selectedAlpha);
      this.graphics.fillRect(bounds.x, bounds.y, bounds.size, bounds.size);
    }
  }

  private createPlayer(): void {
    const pos = this.tileToPixel(this.playerPos);
    const size = this.grid.tileSize * RENDER.playerScale;
    this.player = this.add.rectangle(pos.x, pos.y, size, size, COLORS.playerFill);
  }

  private setupInputHandlers(): void {
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const tile = this.pointerToTile(pointer);
      if (!this.isSameTile(tile, this.hoveredTile)) {
        this.hoveredTile = tile;
        this.render();
      }
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.selectedTile = this.pointerToTile(pointer);
      this.render();
      this.animatePlayerMove();
    });
  }

  private animatePlayerMove(): void {
    if (!this.selectedTile) return;

    this.playerPos = { ...this.selectedTile };
    const targetPos = this.tileToPixel(this.selectedTile);

    this.tweens.add({
      targets: this.player,
      scaleX: RENDER.playerPulseScale,
      scaleY: RENDER.playerPulseScale,
      duration: RENDER.playerPulseDuration,
      yoyo: true,
      ease: "Power2",
    });

    this.tweens.add({
      targets: this.player,
      x: targetPos.x,
      y: targetPos.y,
      duration: RENDER.moveDuration,
      ease: "Power2",
      onComplete: () => this.animateBounce(),
    });
  }

  private animateBounce(): void {
    this.tweens.add({
      targets: this.player,
      scaleY: RENDER.bounceScale,
      duration: RENDER.bounceDuration,
      yoyo: true,
      ease: "Bounce",
    });
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.createPlayer();
    this.render();
    this.setupInputHandlers();
  }
}
