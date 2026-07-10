import { INITIAL_BOARD } from './src/data/initialBoard';
import { cloneBoard } from './src/engine/utils';
import { getLegalMoves, isCheck } from './src/engine/moveGenerator';
import { applyMove } from './src/engine/applyMove';
import { findBestMoveUCI } from './src/engine/uciEngine';
import type { GameState } from './src/engine/types';
import * as fs from 'fs';

async function runFuzzerV3() {
    console.log("Starting Pixie Engine V3 Deep Analytical Fuzzer...");
    
    let crashCount = 0;
    let syncErrors = 0;
    let checkmateMislabels = 0;
    let successfulTraps = 0;
    
    const TOTAL_GAMES = 3; // Reduced games so it completes in a reasonable time
    const MAX_MOVES = 20;
    const TIME_LIMIT_MS = 20000;
    const SEARCH_DEPTH = 7;
    
    for (let game = 1; game <= TOTAL_GAMES; game++) {
        let board = cloneBoard(INITIAL_BOARD);
        
        // Randomly inject 4 power pieces into the board per side
        const piecesToInject: any[] = [
            'ELECTROKNIGHT', 'KNIGHTMARE', 'PHASE_ROOK', 'SUMOROOK', 'FISSION_REACTOR',
            'MARAUDER', 'BLADERUNNER', 'SHRIKE', 'BOUNCER', 'PILGRIM', 'ARISTOCRAT',
            'EPEE_PAWN', 'PAWN_KNIFE', 'HERO_PAWN', 'SHRIKE', 'WARP_JUMPER', 'WAR_AUTOMATON',
            'FISH_KNIGHT', 'BANKER', 'CAMEL', 'ANTI_VIOLENCE'
        ];
        
        // Shuffle pieces
        piecesToInject.sort(() => Math.random() - 0.5);
        let wIdx = 0, bIdx = 0;
        
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (board[r][c]?.color === 'w' && board[r][c]?.type !== 'K' && board[r][c]?.type !== 'P' && wIdx < 4) {
                    board[r][c]!.pixie = piecesToInject[wIdx++];
                }
                if (board[r][c]?.color === 'b' && board[r][c]?.type !== 'K' && board[r][c]?.type !== 'P' && bIdx < 4) {
                    board[r][c]!.pixie = piecesToInject[bIdx++];
                }
            }
        }

        let gameState: any = {
            frozen: [],
            activeCharges: { w: 0, b: 0 },
            paralyzed: { w: [], b: [] },
            offBoardPieces: [],
            promotionBlock: false,
            doomed: {},
            turn: 1,
            castling: { K: true, Q: true, k: true, q: true },
            pendingIcicle: [],
            deadPieces: [],
            activeDancer: null,
            dissipatedDjinns: { w: null, b: null }
        };
        
        let color: 'w' | 'b' = 'w';
        let previousEval = 0;
        
        process.stdout.write(`\nGame ${game}: `);
        
        for (let ply = 0; ply < MAX_MOVES; ply++) {
            let allMoves = [];
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (board[r][c]?.color === color) {
                        const moves = getLegalMoves(board, r, c, gameState);
                        allMoves.push(...moves);
                    }
                }
            }
            
            // Knightmare drops
            for (const ob of gameState.offBoardPieces) {
                if (ob.piece.color === color) {
                     const moves = getLegalMoves(board, ob.obSq[0], ob.obSq[1], gameState);
                     allMoves.push(...moves);
                }
            }

            const isKCheck = isCheck(board, color, gameState);
            
            if (allMoves.length === 0) {
                if (isKCheck) {
                    process.stdout.write(` CHECKMATE`);
                } else {
                    process.stdout.write(` STALEMATE`);
                }
                break; 
            }

            // Call C++ Engine
            try {
                // IMPORTANT: Point findBestMoveUCI to the new engine path if necessary.
                // Assuming it uses the configured engine in uciEngine.ts
                const uciRes = await findBestMoveUCI(board, color, SEARCH_DEPTH, gameState, TIME_LIMIT_MS, 4, 1);
                
                if (!uciRes.move) {
                    process.stdout.write(` (Engine returned NO MOVE)`);
                    if (isKCheck) checkmateMislabels++;
                    break;
                }
                
                const res = applyMove(board, uciRes.move, gameState, {
                    push: () => {}, pop: () => null, decrementFreezes: () => {}
                });
                
                board = res.board;
                gameState = res.gameState;
                
                if (res.effects.includes('ELECTRO_LIGHTNING') || res.effects.includes('SUMOROOK_PUSH')) {
                    successfulTraps++;
                }

                color = color === 'w' ? 'b' : 'w';
                gameState.sideToMove = color;
                process.stdout.write('.');
            } catch (e: any) {
                console.error(`\nCRASH in Game ${game} at Ply ${ply}:`, e);
                crashCount++;
                break;
            }
        }
    }
    
    console.log(`\n\nFuzzing V3 Complete.`);
    console.log(`Crashes: ${crashCount}, Mislabels: ${checkmateMislabels}, Successful Traps: ${successfulTraps}`);
    process.exit(0);
}

runFuzzerV3().catch(console.error);
