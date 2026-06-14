# Pixie Chess

Pixie Chess is a variant of chess featuring **28 unique custom "Pixie" power pieces** alongside standard chess rules. Each power piece possesses custom abilities—ranging from paralysis auras and en passant overrides to edge-bouncing and off-board teleportation—completely redefining traditional chess strategy.

---

## 🎮 Game Rules & Constraints

In addition to standard chess, Pixie Chess introduces key sandbox placement restrictions to balance custom pieces:

1. **Upgrade-Only Placement:** A power piece (e.g. *Electroknight*, base `N`) can **only** replace its corresponding standard piece of the same color (e.g. standard White Knight `N`). It cannot be placed on empty squares or incorrect piece types.
2. **Maximum 6 Power Pieces:** In any given game, a player can place a maximum of **6 power pieces** on the board. Trying to place a 7th will be blocked.
3. **One-King Enforcement:** Traditional King-only constraints apply (no duplicate Kings).

---

## 🧩 Project Architecture

The repository is structured as a monorepo containing the following components:

*   **`pixiechess-bot` (React Frontend)**
    *   Single-Page Application (SPA) built using React, Vite, and Zustand.
    *   Features a responsive canvas-based chessboard, sandbox custom piece selection palette, and coordinate adjustment banners.
    *   Integrates a WebWorker-based WASM chess engine for local browser play.
*   **`pixiechess-server` (Express Backend)**
    *   Node.js/Express server that runs the UCI chess engine in production.
    *   Exposes endpoints:
        *   `POST /api/calculate` & `POST /api/calculate-stream`: Stream AI search values and compute best moves.
        *   `POST /api/suggest-placement`: Generates recommendations for where to place custom pieces.
        *   `POST /api/auto-deploy`: Automatically places a custom loadout.
*   **`pixie-engine-cpp` (C++ Chess Engine)**
    *   Natively written chess engine with alpha-beta search, transposition tables (TT), move ordering, and multi-threaded UCI support.
    *   Fully synchronized to handle all custom piece rules and custom bitboard representations.
    *   Supports NNUE (Efficiently Updatable Neural Network) evaluations natively.
*   **`nnue` (NNUE Training)**
    *   PyTorch training scripts and compiler binaries to train and export `.nnue` weights for the engine.

---

## 🧙 The 28 Pixie Power Pieces

Custom pieces are categorised into three roles: **Lethal** (offensive), **Control** (disruption), and **Indestructible** (defensive/blockers).

### Pawns (`P` base)
*   **Golden Pawn** (Lethal) — Promotion at rank 8 = instant game win (unless blocked by an enemy Aristocrat).
*   **Ironpawn** (Indestructible) — Cannot capture, cannot promote, permanently indestructible. Blocks line of sight (LOS).
*   **Blueprint** (Lethal) — Copies the identity of the pawn directly to its left (file-1) at game start.
*   **Epee Pawn** (Lethal) — Can capture *any* pawn that just moved anywhere on the board (global en passant).
*   **Pawn with Knife** (Lethal) — Diagonal capture extends 2 tiles towards the center d/e files.
*   **Hero Pawn** (Lethal) — Instantly promotes to a Queen if it gives check to the enemy King.
*   **Shrike** (Lethal) — On its first 2-tile forward move, captures any piece in its path.
*   **Warp Jumper** (Lethal) — Can jump directly over any pawn blocking its forward path.
*   **War Automaton** (Lethal) — Automatically slides forward 1 tile whenever any piece on the board is captured.
*   **Hordeling** (Lethal) — Spawned by the Horde Mother; links life to her and cannot promote.

### Knights (`N` base)
*   **Electroknight** (Lethal) — Charges up after 3 consecutive moves. The next capture also explodes one adjacent enemy piece.
*   **Banker** (Lethal) — Capturing an enemy pawn instantly transforms your most-advanced pawn into a Golden Pawn.
*   **Camel** (Lethal) — Leaps in (3,1) and (1,3) L-shapes. Jumps over all obstructions.
*   **Knightmare** (Lethal) — Can jump off-board into limbo. Spends 1 turn in limbo and can then drop onto any empty square.
*   **Anti-Violence** (Control) — Cannot capture. Prevents all adjacent enemy pieces from capturing anything.
*   **Pinata** (Lethal) — Randomly morphs into any other power piece when placed.
*   **Fish** (Lethal) — If it moved last turn, it can make an extra 1-tile quiet move on its next turn.

### Bishops (`B` base)
*   **Aristocrat** (Lethal) — Global passive: While alive, all enemy pawns are completely blocked from promoting.
*   **Basilisk** (Control) — Paralyzes any enemy pieces lying in its diagonal lines of sight at the end of its turn.
*   **Bladerunner** (Lethal) — Bishop slides *through* enemy pieces, marking them doomed to explode on the next turn.
*   **Bouncer** (Lethal) — Bishop moves can bounce off the board edge once per turn.
*   **Pilgrim** (Lethal) — Tracks total travel distance. At 20 tiles, lets you resurrect a captured ally piece.
*   **Dancer** (Lethal) — If a move gives check, gains 2 extra bonus quiet moves immediately.
*   **Djinn** (Lethal) — Can dissipate (disappear) on command. Respawns at its home square upon the next capture.
*   **Gunslinger** (Lethal) — Triggers a duel if target and Gunslinger threaten each other, destroying both instantly.
*   **Cardinal** (Lethal) — Standard Bishop + can take one non-capturing step backwards.
*   **Icicle** (Control) — Freezes adjacent enemies if they stay adjacent for 2 turns.
*   **Horde Mother** (Lethal) — Spawns non-promotable Hordelings upon capture. If she dies, all her Hordelings die.
*   **Marauder** (Lethal) — Moves 1 square like a King, but gains +2 range for every capture it makes.

### Rooks (`R` base)
*   **Phase Rook** (Lethal) — Can slide through your own friendly pieces during movement.
*   **SumoRook** (Control) — Never captures; pushes target enemy piece back 1 square in its attack path.

### Queens (`Q` base)
*   **Fission Reactor** (Lethal) — On its 5th capture, detonates and removes itself plus all adjacent diagonal enemies.

### Kings (`K` base)
*   **Rocketman** (Lethal) — Once per game, can teleport to any empty square not under check.

---

## 🚀 Deployment Guide (GCP VM)

The project includes pre-configured automation scripts to manage deployments.

### 1. Clean Wipe (Reset VM)
To clear old builds and services:
```bash
sudo bash /opt/pixiechess/pixiechess-server/scripts/vm-clean.sh
```

### 2. Full Install / Setup
This script configures Node.js, builds the C++ chess engine natively for Linux, builds the frontend, registers the systemd service, and configures Nginx:
```bash
sudo /opt/pixiechess/pixiechess-server/scripts/vm-setup.sh
```

### 3. Update Existing Server
If you only changed TypeScript/React code and want to rebuild without restarting the C++ compile phase:
```bash
sudo bash /opt/pixiechess/pixiechess-server/scripts/vm-update.sh
```

### 4. Enable SSL (Nginx & Let's Encrypt)
Certbot will auto-renew and configure Nginx for HTTPS:
```bash
sudo certbot --nginx -d prod.asia
```
