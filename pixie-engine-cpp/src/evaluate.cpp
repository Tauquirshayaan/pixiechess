#include "evaluate.h"
#include "bitboard.h"
#include "pst.h"
#include "nnue.h"
#include "movegen.h"
#include "rays.h"

// Material Values (centipawns)
// Calibrated with Grandmaster Deadly Ranking (★ System)
// REBALANCED: All attacking power pieces raised to prevent reckless sacrifices
// and ensure the engine values the FULL arsenal, not just the Knightmare.
const int PIECE_VALUES[PIECE_TYPE_COUNT] = {
    100,  // PAWN
    320,  // KNIGHT (Stockfish)
    330,  // BISHOP (Stockfish)
    500,  // ROOK
    1400, // QUEEN — Tuned for aggressive but calculated play
    20000, // KING (Infinity)
    
    // 8 Pixie Pawns
    200,  // GOLDEN_PAWN
    100,  // IRONPAWN
    150,  // EPEE_PAWN
    120,  // PAWN_KNIFE
    150,  // HERO_PAWN
    150,  // SHRIKE
    130,  // WARP_JUMPER
    100,  // WAR_AUTOMATON

    // 6 Pixie Knights (★★★ Attacking Power Knights)
    400,  // ELECTROKNIGHT — ★★★★ Zap ability devastates clusters; raised from 350
    350,  // BANKER — Raised from 330; utility Knight with banking ability
    320,  // CAMEL — Raised from 310; unique L-shape movement
    360,  // KNIGHTMARE — ★★★★★ Limbo piece; base stays at 360 (cap handles the rest)
    300,  // ANTI_VIOLENCE - Set to 300 as per user request
    330,  // FISH_KNIGHT - Raised from 320; aquatic mobility deserves protection over a standard Knight

    // 12 Pixie Bishops (★★★ Attacking Power Bishops)
    400,  // ARISTOCRAT
    500,  // BASILISK — ★★★★ Raised from 450; paralysis is devastating, must be protected!
    550,  // BLADERUNNER — ★★★★★ King-killer: reduced from 600 to prevent passive hoarding
    380,  // BOUNCER — ★★★ Reduced from 420; power piece should be dynamically traded, not hoarded
    400,  // PILGRIM
    360,  // DANCER
    350,  // DJINN
    350,  // GUNSLINGER — Raised from 340
    360,  // CARDINAL — Raised from 350; backward step ability has tactical value
    450,  // ICICLE — ★★★★ Raised from 420; freeze ability is powerful
    380,  // HORDE_MOTHER — Raised from 350; summons Hordelings
    600,  // MARAUDER — ★★★★★ Game-Ender: snowball potential

    // 2 Pixie Rooks (★★★★ Heavy Attacking Pieces)
    600,  // PHASE_ROOK — ★★★★ Raised from 550; phasing through pieces is extremely powerful!
    550,  // SUMOROOK — ★★★ Raised from 480; pushing ability has major tactical value

    // 1 Pixie Queen
    1600, // FISSION_REACTOR — ★★★★★ Nuclear explosion ability

    // Horde summon
    100    // HORDELING
};

// Helper function to get pawn attacks for a given square and color
inline U64 get_pawn_attacks(int sq, Color c) {
    U64 attacks = 0ULL;
    U64 pawn = 1ULL << sq;
    if (c == WHITE) {
        if ((pawn << 7) & 0x7F7F7F7F7F7F7F7FULL) attacks |= (pawn << 7); // left attack
        if ((pawn << 9) & 0xFEFEFEFEFEFEFEFEULL) attacks |= (pawn << 9); // right attack
    } else {
        if ((pawn >> 7) & 0xFEFEFEFEFEFEFEFEULL) attacks |= (pawn >> 7); // right attack
        if ((pawn >> 9) & 0x7F7F7F7F7F7F7F7FULL) attacks |= (pawn >> 9); // left attack
    }
    return attacks;
}

std::string analysis_mode = "Normal";
std::string counterfactual_target = "None";
bool in_counterfactual_explanation = false;
thread_local EvaluationBreakdown* tl_breakdown = nullptr;

EvaluationBreakdown explain_evaluation(const Board& b) {
    EvaluationBreakdown breakdown;
    tl_breakdown = &breakdown;
    evaluate(b);
    tl_breakdown = nullptr;
    return breakdown;
}

int evaluate(const Board& b) {
#ifdef ENABLE_COUNTERFACTUAL
    if (analysis_mode == "Counterfactual" && !in_counterfactual_explanation) {
        in_counterfactual_explanation = true;
        EvaluationBreakdown brk = explain_evaluation(b);
        in_counterfactual_explanation = false;
        
        int score = brk.total();
        if (counterfactual_target == "knightmare") score -= brk.km.total();
        else if (counterfactual_target == "marauder") score -= brk.marauder_score;
        else if (counterfactual_target == "phaserook") score -= brk.phaserook_score;
        else if (counterfactual_target == "electroknight") score -= brk.electroknight_score;
        else if (counterfactual_target == "djinn") score -= brk.djinn_score;
        else if (counterfactual_target == "material") score -= brk.material;
        else if (counterfactual_target == "mobility") score -= brk.mobility;
        else if (counterfactual_target == "development") score -= brk.development;
        else if (counterfactual_target == "threats") score -= brk.threats;
        else if (counterfactual_target == "king_safety") score -= brk.king_safety;
        else if (counterfactual_target == "center_control") score -= brk.center_control;
        else if (counterfactual_target == "power_potential") score -= brk.power_potential;
        
        // Return score correctly aligned with side_to_move
        return (b.side_to_move == WHITE) ? score : -score;
    }
#endif

    int nnue_score = 0;
    if (NNUE::is_loaded()) {
        nnue_score = NNUE::evaluate(b);
    }
    
    // Classical Evaluation
    int classical_score = 0;
    
    // Simple endgame detection (if total non-pawn material is low)
    int non_pawn_material = 0;
    
    // Calculate non-pawn material for endgame detection
    for (int pt = KNIGHT; pt < PIECE_TYPE_COUNT; pt++) {
        if (pt == KING) continue;
        if (pt >= GOLDEN_PAWN && !(b.active_pixies[WHITE] & (1ULL << pt)) && !(b.active_pixies[BLACK] & (1ULL << pt))) continue;
        non_pawn_material += popcount(b.pieces[WHITE][pt]) * PIECE_VALUES[pt];
        non_pawn_material += popcount(b.pieces[BLACK][pt]) * PIECE_VALUES[pt];
    }
    non_pawn_material += b.num_knightmares_limbo[WHITE] * PIECE_VALUES[KNIGHTMARE];
    non_pawn_material += b.num_knightmares_limbo[BLACK] * PIECE_VALUES[KNIGHTMARE];
    if (b.dissipated_djinn_sqs[WHITE] != NO_SQ) non_pawn_material += PIECE_VALUES[DJINN];
    if (b.dissipated_djinn_sqs[BLACK] != NO_SQ) non_pawn_material += PIECE_VALUES[DJINN];
    
    // Smooth Phase Detection: 1.0 = Middlegame, 0.0 = Endgame
    float gamePhase = (float)non_pawn_material / 8000.0f;
    if (gamePhase > 1.0f) gamePhase = 1.0f;
    if (gamePhase < 0.0f) gamePhase = 0.0f;
    
    // ---- INSUFFICIENT MATERIAL DETECTION ----
    // If neither side has any pieces except King/Rocketman, it's a dead draw.
    U64 w_non_king = b.occupancies[WHITE] & ~(b.pieces[WHITE][KING]);
    U64 b_non_king = b.occupancies[BLACK] & ~(b.pieces[BLACK][KING]);
    if (!w_non_king && !b_non_king) return 0; // K vs K — dead draw
    
    // ---- RESILIENCE / MATERIAL IMBALANCE TRACKER (Principle 7 & 8) ----
    // Calculate each side's material independently to detect who is losing
    int white_material = 0, black_material = 0;
    for (int pt = PAWN; pt < PIECE_TYPE_COUNT; pt++) {
        if (pt == KING) continue;
        if (pt >= GOLDEN_PAWN && !(b.active_pixies[WHITE] & (1ULL << pt)) && !(b.active_pixies[BLACK] & (1ULL << pt))) continue;
        white_material += popcount(b.pieces[WHITE][pt]) * PIECE_VALUES[pt];
        black_material += popcount(b.pieces[BLACK][pt]) * PIECE_VALUES[pt];
    }
    white_material += b.num_knightmares_limbo[WHITE] * PIECE_VALUES[KNIGHTMARE];
    black_material += b.num_knightmares_limbo[BLACK] * PIECE_VALUES[KNIGHTMARE];
    if (b.dissipated_djinn_sqs[WHITE] != NO_SQ) white_material += PIECE_VALUES[DJINN];
    if (b.dissipated_djinn_sqs[BLACK] != NO_SQ) black_material += PIECE_VALUES[DJINN];
    
    // material_deficit > 0 means White is losing, < 0 means Black is losing
    int material_deficit_w = black_material - white_material;
    int material_deficit_b = white_material - black_material;
    
    if (tl_breakdown) {
        tl_breakdown->fingerprint.material_imbalance = white_material - black_material;
        tl_breakdown->fingerprint.alive_knightmare = popcount(b.pieces[WHITE][KNIGHTMARE] | b.pieces[BLACK][KNIGHTMARE]) + b.num_knightmares_limbo[WHITE] + b.num_knightmares_limbo[BLACK];
        tl_breakdown->fingerprint.alive_marauder = popcount(b.pieces[WHITE][MARAUDER] | b.pieces[BLACK][MARAUDER]);
        tl_breakdown->fingerprint.alive_phaserook = popcount(b.pieces[WHITE][PHASE_ROOK] | b.pieces[BLACK][PHASE_ROOK]);
        tl_breakdown->fingerprint.alive_electroknight = popcount(b.pieces[WHITE][ELECTROKNIGHT] | b.pieces[BLACK][ELECTROKNIGHT]);
        tl_breakdown->fingerprint.alive_djinn = popcount(b.pieces[WHITE][DJINN] | b.pieces[BLACK][DJINN]);
        tl_breakdown->fingerprint.alive_basilisk = popcount(b.pieces[WHITE][BASILISK] | b.pieces[BLACK][BASILISK]);
        
        tl_breakdown->fingerprint.knightmares_in_limbo = b.num_knightmares_limbo[WHITE] + b.num_knightmares_limbo[BLACK];
        
        U64 fileA = 0x0101010101010101ULL;
        for (int f = 0; f < 8; f++) {
            U64 file_mask = fileA << f;
            U64 wp = b.pieces[WHITE][PAWN] & file_mask;
            U64 bp = b.pieces[BLACK][PAWN] & file_mask;
            if (!wp && !bp) tl_breakdown->fingerprint.open_files++;
            else if (!wp || !bp) tl_breakdown->fingerprint.semi_open_files++;
            
            if (popcount(wp) > 1 || popcount(bp) > 1) tl_breakdown->fingerprint.doubled_pawns++;
        }
        
        U64 center = 0x0000001818000000ULL;
        tl_breakdown->fingerprint.center_occupancy = popcount((b.occupancies[WHITE] | b.occupancies[BLACK]) & center);
    }
    
    for (int c = WHITE; c <= BLACK; c++) {
        int color_sign = (c == WHITE) ? 1 : -1;
        Color them = (c == WHITE) ? BLACK : WHITE;
        
        // ---- RESILIENCE AGGRESSION BOOST (Principle 7: Never Give Up) ----
        // If this side is significantly behind on material, boost aggression:
        // inflate remaining own pieces' value and push the engine to fight harder
        int my_deficit = (c == WHITE) ? material_deficit_w : material_deficit_b;
        if (my_deficit > 400) {
            // We are losing by more than 4 pawns — activate aggression mode
            // Reward any remaining power pieces for being active and forward
            int aggression_bonus = std::min(my_deficit / 20, 80); // cap at 80cp
            classical_score += aggression_bonus * color_sign;
            if (tl_breakdown) tl_breakdown->king_safety += aggression_bonus * color_sign;
        }
        
        // ============================================================
        //  FIX 1: DYNAMIC ARSENAL AWARENESS (Principles 7 & 8) — COMPLETE
        //  Full 10-stage priority chain covering every power piece type.
        //  Engine auto-detects surviving pieces and builds game plan accordingly.
        // ============================================================
        {
            bool has_marauder   = (b.pieces[c][MARAUDER]        != 0);
            bool has_basilisk   = (b.pieces[c][BASILISK]        != 0);
            bool has_fission    = (b.pieces[c][FISSION_REACTOR] != 0);
            bool has_electro    = (b.pieces[c][ELECTROKNIGHT]   != 0);
            bool has_icicle     = (b.pieces[c][ICICLE]          != 0);
            bool has_dancer     = (b.pieces[c][DANCER]          != 0);
            bool has_knightmare = (b.pieces[c][KNIGHTMARE]      != 0 || b.num_knightmares_limbo[c] > 0);
            bool has_sumorook   = (b.pieces[c][SUMOROOK]        != 0);
            bool has_phase_rook = (b.pieces[c][PHASE_ROOK]      != 0);
            bool has_queen      = (b.pieces[c][QUEEN]           != 0);
            U64 eking_ar = b.pieces[them][KING];
            
            if (eking_ar) {
                int ksq2 = get_lsb(eking_ar);
                if (b.ability_tracker[ksq2].frozen_turns > 0 && b.is_square_attacked(ksq2, (Color)c)) {
                    classical_score += 50000 * color_sign; // Paralyzed king in check! Massive bonus to force mate!
                    if (tl_breakdown) tl_breakdown->threats += 50000 * color_sign;
                }
            }
            
            // Determine Strategic Goals for ALL alive power pieces
            // By making these independent 'if' blocks, the engine synergizes 
            // multiple power pieces simultaneously instead of tunnel-visioning.
            if (has_marauder) {
                // MARAUDER MODE: Push it forward aggressively into enemy territory
                U64 mar = b.pieces[c][MARAUDER];
                while (mar) {
                    int msq = pop_lsb(mar);
                    int mr = msq / 8;
                    int mc = msq % 8;
                    
                    // Massive bonus just for getting off the back rank (moves 1 & 2)
                    bool developed = (c == WHITE) ? (mr >= 1) : (mr <= 6);
                    if (developed) {
                        classical_score += (int)(60 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(60 * gamePhase) * color_sign;
                    }
                    
                    // Huge bonus for crossing into enemy territory
                    bool in_enemy = (c == WHITE) ? (mr >= 3) : (mr <= 4);
                    if (in_enemy) {
                        classical_score += (int)(150 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(150 * gamePhase) * color_sign;
                    }
                    
                    // Centralize the Marauder to maximize capture opportunities
                    if (mc >= 2 && mc <= 5) {
                        classical_score += (int)(30 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(30 * gamePhase) * color_sign;
                    }
                }
            }
            
            if (has_basilisk) {
                // BASILISK MODE: Zone control & paralysis traps
                U64 bas = b.pieces[c][BASILISK];
                U64 eking = b.pieces[them][KING];
                U64 tmp_bas = bas;
                while (tmp_bas && eking) {
                    int bsq = pop_lsb(tmp_bas);
                    int br = bsq / 8, bc2 = bsq % 8;
                    int ksq2 = get_lsb(eking);
                    int kr2 = ksq2 / 8, kc2 = ksq2 % 8;
                    if (std::abs(br - kr2) == std::abs(bc2 - kc2)) {
                        classical_score += (int)(50 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(50 * gamePhase) * color_sign;
                    }
                }
                // Basilisk Momentum: Attack paralyzed high-value targets
                U64 enemy_hv_all = b.pieces[them][QUEEN] | b.pieces[them][ROOK] | b.pieces[them][MARAUDER] | b.pieces[them][FISSION_REACTOR] | b.pieces[them][PHASE_ROOK] | b.pieces[them][ELECTROKNIGHT] | b.pieces[them][BLADERUNNER] | b.pieces[them][BOUNCER];
                tmp_bas = bas;
                while (tmp_bas) {
                    int bsq = pop_lsb(tmp_bas);
                    U64 paralyzed = get_sliding_attacks(bsq, b.occupancies[BOTH], true, false);
                    U64 paralyzed_hv = paralyzed & enemy_hv_all;
                    while(paralyzed_hv) {
                        int psq = pop_lsb(paralyzed_hv);
                        if (b.is_square_attacked(psq, (Color)c)) {
                            classical_score += 40 * color_sign; // Momentum bonus
                            if (tl_breakdown) tl_breakdown->threats += 40 * color_sign;
                        }
                    }
                }
            }
            
            if (has_fission) {
                // REACTOR MODE: Proximity threat to King
                U64 fis = b.pieces[c][FISSION_REACTOR];
                U64 eking = b.pieces[them][KING];
                while (fis && eking) {
                    int fsq2 = pop_lsb(fis);
                    int ksq2 = get_lsb(eking);
                    int fr2 = fsq2 / 8, fc3 = fsq2 % 8;
                    int kr2 = ksq2 / 8, kc2 = ksq2 % 8;
                    int dist = std::max(std::abs(fr2 - kr2), std::abs(fc3 - kc2));
                    if (dist <= 1) {
                        classical_score += 3000 * color_sign; // Massive explosion threat
                        if (tl_breakdown) tl_breakdown->threats += 3000 * color_sign;
                    } else if (dist <= 4) {
                        classical_score += (int)(35 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(35 * gamePhase) * color_sign;
                    }
                }
            }
            
            if (has_electro) {
                // ELECTROKNIGHT MODE: Charge up & advance aggressively
                U64 ekn = b.pieces[c][ELECTROKNIGHT];
                while (ekn) {
                    int esq = pop_lsb(ekn);
                    int emoves = b.ability_tracker[esq].electro_moves;
                    classical_score += (int)(emoves * 20 * gamePhase) * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += (int)(emoves * 20 * gamePhase) * color_sign;
                    bool advanced = (c == WHITE) ? (esq / 8 >= 3) : (esq / 8 <= 4);
                    if (advanced) classical_score += (int)(25 * gamePhase) * color_sign;
                    if (advanced) if (tl_breakdown) tl_breakdown->power_potential += (int)(25 * gamePhase) * color_sign;
                }
            }
            
            if (has_icicle) {
                // ICICLE MODE: Freeze high-value enemy pieces
                U64 ice = b.pieces[c][ICICLE];
                while (ice) {
                    int isq = pop_lsb(ice);
                    int ir = isq / 8, ic2 = isq % 8;
                    U64 hi_value = b.pieces[them][QUEEN] | b.pieces[them][FISSION_REACTOR]
                                 | b.pieces[them][ROOK]  | b.pieces[them][PHASE_ROOK];
                    U64 tmp_hv = hi_value;
                    while (tmp_hv) {
                        int tsq = pop_lsb(tmp_hv);
                        int dist = std::max(std::abs(ir - tsq / 8), std::abs(ic2 - tsq % 8));
                        if (dist <= 3) classical_score += (int)(30 * gamePhase) * color_sign;
                        if (dist <= 3) if (tl_breakdown) tl_breakdown->power_potential += (int)(30 * gamePhase) * color_sign;
                    }
                }
            }
            
            if (has_dancer) {
                // DANCER MODE: Seek check → earn 2 bonus non-capture moves
                U64 dan = b.pieces[c][DANCER];
                while (dan && eking_ar) {
                    int dsq2 = pop_lsb(dan);
                    int dr2 = dsq2 / 8, dc2 = dsq2 % 8;
                    int ksq2 = get_lsb(eking_ar);
                    int kr2 = ksq2 / 8, kc2 = ksq2 % 8;
                    if (std::abs(dr2 - kr2) == std::abs(dc2 - kc2))
                        classical_score += (int)(45 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(45 * gamePhase) * color_sign;
                }
            }
            
            if (has_knightmare) {
                // KNIGHTMARE MODE: Limbo ambush + forward board pressure
                int limbo = b.num_knightmares_limbo[c];
                // Limbo Knightmares are a persistent strategic asset throughout the entire game
                classical_score += (int)(limbo * 80 * gamePhase) * color_sign;
                if (tl_breakdown) {
                    tl_breakdown->km.limbo_persistence += (int)(limbo * 80 * gamePhase) * color_sign;
                    tl_breakdown->limbo_active = (b.num_knightmares_limbo[c] > 0);
                    tl_breakdown->km.state.count_in_limbo = b.num_knightmares_limbo[c];
                    tl_breakdown->km.state.count_on_board = popcount(b.pieces[c][KNIGHTMARE]);
                }
                // Extra mid-game urgency: reward the Knightmare for having safe drop squares
                if (limbo > 0 && gamePhase > 0.3f) {
                    int km_dirs[8][2] = {{-2,-1},{-2,1},{-1,-2},{-1,2},{1,-2},{1,2},{2,-1},{2,1}};
                    for (int ki = 0; ki < limbo; ki++) {
                        uint8_t enc = b.knightmare_limbo_coords[c][ki];
                        int ob_r = (enc >> 4) - 3;
                        int ob_c2 = (enc & 0xF) - 3;
                        int safe_drops = 0;
                        for (int d = 0; d < 8; d++) {
                            int nr = ob_r + km_dirs[d][0];
                            int nc = ob_c2 + km_dirs[d][1];
                            if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
                                int drop_sq = nr * 8 + nc;
                                if (!get_bit(b.occupancies[BOTH], drop_sq) &&
                                    !b.is_square_attacked(drop_sq, them))
                                    safe_drops++;
                            }
                        }
                        // Drop urgency: up to +60cp for having good drop squares
                        classical_score += (int)(safe_drops * 8 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->km.deployment_readiness += (int)(safe_drops * 8 * gamePhase) * color_sign;
                    }
                }
                U64 knm = b.pieces[c][KNIGHTMARE];
                while (knm) {
                    int ksq3 = pop_lsb(knm);
                    bool advanced = (c == WHITE) ? (ksq3 / 8 >= 3) : (ksq3 / 8 <= 4);
                    if (advanced) classical_score += (int)(25 * gamePhase) * color_sign;
                    if (advanced) if (tl_breakdown) tl_breakdown->power_potential += (int)(25 * gamePhase) * color_sign;
                }
            }
            
            if (has_sumorook) {
                // SUMOROOK MODE: Central push physics control
                U64 sur = b.pieces[c][SUMOROOK];
                while (sur) {
                    int ssq = pop_lsb(sur);
                    int sr = ssq / 8, sc2 = ssq % 8;
                    if (sr >= 2 && sr <= 5 && sc2 >= 2 && sc2 <= 5) {
                        classical_score += (int)(25 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(25 * gamePhase) * color_sign;
                    }
                }
            }
            
            if (has_phase_rook || has_queen) {
                // BATTERY MODE: Queen + Phase Rook central file control
                U64 battery = b.pieces[c][PHASE_ROOK] | b.pieces[c][QUEEN];
                while (battery) {
                    int bsq2 = pop_lsb(battery);
                    int bc3 = bsq2 % 8;
                    if (bc3 >= 2 && bc3 <= 5) {
                        classical_score += (int)(20 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(20 * gamePhase) * color_sign;
                    }
                }
            }
            
            // STAGE 10 — ENDGAME MOP-UP: Active King + pawn push
            if (!has_marauder && !has_basilisk && !has_fission && !has_electro && !has_queen) {
                U64 our_king = b.pieces[c][KING];
                if (our_king) {
                    int ksq2 = get_lsb(our_king);
                    bool king_active = (c == WHITE) ? (ksq2 / 8 >= 3) : (ksq2 / 8 <= 4);
                    if (king_active) {
                        classical_score += (int)(30 * (1.0f - gamePhase)) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(30 * (1.0f - gamePhase)) * color_sign;
                    }
                }
            }
        }

        // ============================================================
        //  FIX 2: DEPENDENCY DIVERSIFICATION NUDGE (Principle 8) — COMPLETE
        //  When <= 1 power piece alive, reward activating ALL piece types:
        //  Knights, Bishop-types, and Rooks — not just one category.
        //  Capped strictly at +15cp to preserve focus.
        // ============================================================
        {
            int active_power_pieces = 0;
            if (b.pieces[c][MARAUDER])          active_power_pieces++;
            if (b.pieces[c][BASILISK])          active_power_pieces++;
            if (b.pieces[c][FISSION_REACTOR])   active_power_pieces++;
            if (b.pieces[c][PHASE_ROOK])        active_power_pieces++;
            if (b.pieces[c][ELECTROKNIGHT])     active_power_pieces++;
            if (b.pieces[c][ICICLE])            active_power_pieces++;
            if (b.pieces[c][DANCER])            active_power_pieces++;
            if (b.pieces[c][SUMOROOK])          active_power_pieces++;
            if (b.num_knightmares_limbo[c] > 0) active_power_pieces++;

            if (active_power_pieces <= 1 && gamePhase > 0.5f) {
                int developed = 0;
                // Knights + all Knight-variants off back rank
                U64 kn_all = b.pieces[c][KNIGHT]  | b.pieces[c][CAMEL]
                           | b.pieces[c][BANKER]   | b.pieces[c][FISH_KNIGHT]
                           | b.pieces[c][ANTI_VIOLENCE];
                U64 tmp2 = kn_all;
                while (tmp2) { int s2 = pop_lsb(tmp2); if ((c==WHITE)?(s2/8>=2):(s2/8<=5)) developed++; }
                // Bishops + all Bishop-variants off back rank
                U64 bi_all = b.pieces[c][BISHOP]     | b.pieces[c][ARISTOCRAT]
                           | b.pieces[c][BLADERUNNER] | b.pieces[c][BOUNCER]
                           | b.pieces[c][PILGRIM]     | b.pieces[c][DJINN]
                           | b.pieces[c][GUNSLINGER]  | b.pieces[c][CARDINAL]
                           | b.pieces[c][HORDE_MOTHER];
                tmp2 = bi_all;
                while (tmp2) { int s2 = pop_lsb(tmp2); if ((c==WHITE)?(s2/8>=2):(s2/8<=5)) developed++; }
                // Standard Rooks off back rank
                U64 rk_all = b.pieces[c][ROOK];
                tmp2 = rk_all;
                while (tmp2) { int s2 = pop_lsb(tmp2); if ((c==WHITE)?(s2/8>=2):(s2/8<=5)) developed++; }
                // Gentle breadth reward — capped at +15cp
                classical_score += std::min(developed * 8, 15) * color_sign;
                if (tl_breakdown) tl_breakdown->development += std::min(developed * 8, 15) * color_sign;
            }
        }

        // Restore dissipated DJINN base material value
        if (b.dissipated_djinn_sqs[c] != NO_SQ) {
            classical_score += PIECE_VALUES[DJINN] * color_sign;
            if (tl_breakdown) tl_breakdown->power_potential += PIECE_VALUES[DJINN] * color_sign;
            classical_score += 150 * color_sign; // Bonus for being safely dissipated (untargetable) and ready to respawn;
            if (tl_breakdown) tl_breakdown->power_potential += 150 * color_sign; // Bonus for being safely dissipated (untargetable) and ready to respawn;
        }
        
        // Add Limbo Knightmare base material value so engine doesn't think dropping it creates free material
        if (b.num_knightmares_limbo[c] > 0) {
            classical_score += b.num_knightmares_limbo[c] * PIECE_VALUES[KNIGHTMARE] * color_sign;
            if (tl_breakdown) tl_breakdown->material += b.num_knightmares_limbo[c] * PIECE_VALUES[KNIGHTMARE] * color_sign;
        }
        
        // ============================================================
        //  PHASE 1: Material + PST (with dynamic ability scaling)
        // ============================================================
        
        // Determine if central pawns are still idle (for minor piece gatekeeper penalty)
        bool central_pawns_idle = false;
        if (gamePhase >= 0.5f) {
            U64 all_pawns = b.pieces[c][PAWN];
            for (int p_pt = GOLDEN_PAWN; p_pt <= WAR_AUTOMATON; p_pt++) {
                all_pawns |= b.pieces[c][p_pt];
            }
            if (c == WHITE) {
                if (get_bit(all_pawns, 11) && get_bit(all_pawns, 12)) central_pawns_idle = true; // BOTH d2 AND e2 idle
            } else {
                if (get_bit(all_pawns, 51) && get_bit(all_pawns, 52)) central_pawns_idle = true; // BOTH d7 AND e7 idle
            }
        }
        

        for (int pt = 0; pt < PIECE_TYPE_COUNT; pt++) {
            U64 bb = b.pieces[c][pt];
            const int* pst_mg = get_pst(pt, false);
            const int* pst_eg = get_pst(pt, true);
            
            while (bb) {
                int sq = pop_lsb(bb);
                
                // Base Material score
                int piece_val = get_dynamic_piece_value(b, pt, sq, (Color)c);
                
                // ---- MARAUDER SNOWBALL + EARLY EXPANSION ----
                if (pt == MARAUDER) {
                    // Opening Principle 2: Reward Marauder for advancing into enemy half early
                    
                    int r = sq / 8;
                    bool in_enemy_half = (c == WHITE) ? (r >= 4) : (r <= 3);
                    if (in_enemy_half) {
                        // Scale bonus by how deep it penetrates (+30cp per rank)
                        int depth = (c == WHITE) ? (r - 3) : (4 - r);
                        classical_score += (int)(depth * 30) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(depth * 30) * color_sign;
                    }
                    
                }
                
                // ---- BASILISK PRESERVATION + ZONE COVERAGE ----
                if (pt == BASILISK) {
                    int r = sq / 8;
                    int fc = sq % 8;
                    // White is overextended if on rank 5+ (r > 3). Black if on rank 4- (r < 4).
                    bool overextended = (c == WHITE) ? (r > 3) : (r < 4);
                    if (overextended) {
                        classical_score -= (int)(80 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential -= (int)(80 * gamePhase) * color_sign;
                    }
                    // Opening Principle 3: Zone Coverage bonus — reward diagonal alignment toward enemy King
                    // Basilisk paralyzes on diagonals, so reward positioning on key diagonals
                    U64 enemy_king_bb = b.pieces[them][KING];
                    if (enemy_king_bb) {
                        int ksq = get_lsb(enemy_king_bb);
                        int kr = ksq / 8, kc = ksq % 8;
                        // Check if Basilisk is on the same diagonal as enemy King
                        bool on_diagonal = (std::abs(r - kr) == std::abs(fc - kc));
                        if (on_diagonal) {
                            classical_score += (int)(60 * gamePhase) * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential += (int)(60 * gamePhase) * color_sign;
                        }
                    }
                }
                
                // ---- QUEEN & REACTOR PRESERVATION (Opening Principles) ----
                if (pt == QUEEN || pt == FISSION_REACTOR) {
                    // Penalize premature Queen exposure in the opening
                    if (gamePhase >= 0.6f) {
                        int r = sq / 8;
                        bool early_exposure = (c == WHITE) ? (r > 1) : (r < 6);
                        if (early_exposure) {
                            // Heavy penalty that forces Queen back to home ranks early
                            classical_score -= (int)(150 * gamePhase * gamePhase) * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential -= (int)(150 * gamePhase * gamePhase) * color_sign;
                        }
                    }
                }

                // ---- PAWN OPENING DEVELOPMENT ----
                if (pt == PAWN || (pt >= GOLDEN_PAWN && pt <= WAR_AUTOMATON)) {
                    if (gamePhase >= 0.5f) {
                        int r = sq / 8;
                        int fc = sq % 8;
                        bool is_standard_pawn = (pt == PAWN);
                        bool is_power_pawn = !is_standard_pawn;
                        bool is_central_file = (fc == 3 || fc == 4); // d or e file
                        bool is_flank_file = (fc <= 1 || fc >= 6); // a, b, g, h files
                        bool on_start = (c == WHITE) ? (r <= 1) : (r >= 6);
                        
                        if (is_standard_pawn) {
                            // Standard Pawns: Push to center, penalize idleness
                            // DYNAMIC STRATEGY: If we DO NOT have a Knightmare, we must rely heavily on pawn structure!
                            bool has_knightmare = (b.pieces[c][KNIGHTMARE] != 0) || (b.num_knightmares_limbo[c] > 0);
                            
                            if (is_central_file && on_start) {
                                // The Stick: Severe penalty for leaving d/e pawns on start
                                int idle_penalty = has_knightmare ? 100 : 150; // Harsher penalty if no Knightmare
                                classical_score -= (int)(idle_penalty * gamePhase) * color_sign;
                                if (tl_breakdown) tl_breakdown->power_potential -= (int)(idle_penalty * gamePhase) * color_sign;
                            } else if (!on_start) {
                                // Reward advancing, especially central files
                                // The Carrot: Double the bonus if we have no Knightmare to rely on
                                int central_bonus = (fc >= 2 && fc <= 5) ? 20 : 10;
                                if (!has_knightmare) central_bonus *= 2; 
                                
                                // Experiment 3: Contextual True Center Control
                                // Reward pawns on d4, e4, d5, e5 that are supported by our own pieces in the opening
                                bool is_true_center = (r == 3 || r == 4) && (fc == 3 || fc == 4);
                                if (is_true_center && gamePhase >= 0.7f) {
                                    if (b.is_square_attacked(sq, (Color)c)) {
                                        central_bonus += 10;
                                        if (tl_breakdown) {
                                            tl_breakdown->center_control += (int)(10 * gamePhase) * color_sign;
                                            tl_breakdown->supported_center_pawn = true;
                                        }
                                    }
                                }
                                
                                classical_score += (int)(central_bonus * gamePhase) * color_sign;
                                if (tl_breakdown) {
                                    tl_breakdown->power_potential += (int)(central_bonus * gamePhase) * color_sign;
                                }
                            }
                        } else if (is_power_pawn) {
                            // Power Pawns: Flank deployment for survival
                            if (!on_start) {
                                if (is_central_file) {
                                    if (pt != EPEE_PAWN && pt != PAWN_KNIFE) {
                                        // Penalty for advancing into the center meatgrinder early
                                        classical_score -= (int)(30 * gamePhase) * color_sign;
                                        if (tl_breakdown) tl_breakdown->power_potential -= (int)(30 * gamePhase) * color_sign;
                                    } else {
                                        // Bonus for Sniper/Fighter in the center
                                        classical_score += (int)(30 * gamePhase) * color_sign;
                                        if (tl_breakdown) tl_breakdown->power_potential += (int)(30 * gamePhase) * color_sign;
                                    }
                                } else if (is_flank_file) {
                                    // Bonus for advancing safely on the flanks
                                    classical_score += (int)(25 * gamePhase) * color_sign;
                                    if (tl_breakdown) tl_breakdown->power_potential += (int)(25 * gamePhase) * color_sign;
                                } else {
                                    // Slight bonus for c/f files
                                    classical_score += (int)(10 * gamePhase) * color_sign;
                                    if (tl_breakdown) tl_breakdown->power_potential += (int)(10 * gamePhase) * color_sign;
                                }
                            }
                        }
                    }
                }
                
                // ============================================================
                //  EARLY OPENING POWER PIECE PENALTIES (Anti-Clogging)
                // ============================================================
                if (gamePhase >= 0.75f) {
                    // Central Pawns (d, e files)
                    U64 d_pawn_start = (c == WHITE) ? (1ULL << 11) : (1ULL << 51); // d2/d7
                    U64 e_pawn_start = (c == WHITE) ? (1ULL << 12) : (1ULL << 52); // e2/e7
                    
                    U64 all_pawns = b.pieces[c][PAWN];
                    for (int p_pt = GOLDEN_PAWN; p_pt <= WAR_AUTOMATON; p_pt++) {
                        all_pawns |= b.pieces[c][p_pt];
                    }
                    all_pawns |= b.pieces[c][HORDELING];

                    bool d_pushed = (all_pawns & d_pawn_start) == 0;
                    bool e_pushed = (all_pawns & e_pawn_start) == 0;
                    
                    if (!d_pushed && !e_pushed) {
                        // Penalize moving ANY non-pawn piece before central pawns
                        U64 early_movers = b.occupancies[c] ^ all_pawns ^ b.pieces[c][KING];
                        // Marauder, Knightmare, and SumoRook are always allowed to develop early
                        early_movers &= ~b.pieces[c][MARAUDER];
                        early_movers &= ~b.pieces[c][KNIGHTMARE];
                        early_movers &= ~b.pieces[c][SUMOROOK];
                        
                        U64 starting_ranks = (c == WHITE) ? 0x000000000000FFFFULL : 0xFFFF000000000000ULL;
                        U64 moved_early = early_movers & ~starting_ranks;
                        
                        if (get_bit(moved_early, sq)) {
                            // Reduced from 120 to 55 — penalty must not overwhelm development bonuses
                            classical_score -= 55 * color_sign;
                            if (tl_breakdown) tl_breakdown->development -= 55 * color_sign;
                        }
                    }
                    
                    // Reward Marauder development — with Pawn Gateway incentive
                    if (pt == MARAUDER) {
                        int r = sq / 8;
                        int fc = sq % 8;
                        bool on_start = (c == WHITE) ? (r <= 1) : (r >= 6);
                        if (!on_start) {
                            classical_score += 120 * color_sign; // BIG reward for active Marauder!
                            if (tl_breakdown) tl_breakdown->power_potential += 120 * color_sign;
                        } else {
                            // Marauder is STUCK on the back rank. Apply a heavy penalty
                            // AND check if adjacent pawns can be pushed to open a lane.
                            classical_score -= 100 * color_sign; // Severe back-rank penalty
                            if (tl_breakdown) tl_breakdown->power_potential -= 100 * color_sign;
                            
                            // Pawn Gateway: penalize each friendly pawn that blocks the Marauder
                            int gateway_dirs[5][2] = {{-1,0},{1,0},{0,-1},{0,1},{0,0}}; // Check cardinal + diagonals
                            if (c == WHITE) {
                                gateway_dirs[0][0] = 1; gateway_dirs[0][1] = 0; // Forward
                                gateway_dirs[1][0] = 1; gateway_dirs[1][1] = -1; // Forward-left
                                gateway_dirs[2][0] = 1; gateway_dirs[2][1] = 1;  // Forward-right
                            } else {
                                gateway_dirs[0][0] = -1; gateway_dirs[0][1] = 0;
                                gateway_dirs[1][0] = -1; gateway_dirs[1][1] = -1;
                                gateway_dirs[2][0] = -1; gateway_dirs[2][1] = 1;
                            }
                            int blocked_count = 0;
                            for (int gd = 0; gd < 3; gd++) {
                                int gr = r + gateway_dirs[gd][0];
                                int gc = fc + gateway_dirs[gd][1];
                                if (gr >= 0 && gr <= 7 && gc >= 0 && gc <= 7) {
                                    int gsq = gr * 8 + gc;
                                    if (get_bit(b.occupancies[c], gsq)) blocked_count++;
                                }
                            }
                            // Extra penalty per blocking piece — this forces the engine to push pawns
                            classical_score -= (blocked_count * 40) * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential -= (blocked_count * 40) * color_sign;
                        }
                    }
                    
                    // Penalize utility power pieces moving early
                    bool is_utility = (pt == BANKER || 
                                       pt == FISSION_REACTOR || pt == DANCER || pt == DJINN);
                    if (is_utility) {
                        int r = sq / 8;
                        bool on_start = (c == WHITE) ? (r <= 1) : (r >= 6);
                        if (!on_start) {
                            classical_score -= 50 * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential -= 50 * color_sign;
                        }
                    }
                }
                
                // ---- MINOR PIECE OPENING DEVELOPMENT (Principle 4 & Gatekeeper) ----
                // Basilisk & Icicle excluded: high-value strategic pieces with own dedicated eval
                bool is_minor = (pt == KNIGHT || pt == BISHOP || pt == ARISTOCRAT || pt == BLADERUNNER || pt == CARDINAL ||
                                 pt == ELECTROKNIGHT || pt == KNIGHTMARE || pt == CAMEL || pt == BANKER || 
                                 pt == FISH_KNIGHT || pt == BOUNCER || pt == PILGRIM || pt == DJINN || pt == DANCER || 
                                 pt == GUNSLINGER || pt == HORDE_MOTHER);
                
                if (is_minor && gamePhase >= 0.5f) {
                    int r = sq / 8;
                    int fc = sq % 8;
                    bool on_start = (c == WHITE) ? (r <= 1) : (r >= 6); // Ranks 1-2 for white, 7-8 for black are start ranks
                    
                    if (on_start) {
                        // Broadened idle penalty for all minor pieces
                        classical_score -= (int)(40 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential -= (int)(40 * gamePhase) * color_sign;
                    } else {
                        // Piece has moved!
                        // Gatekeeper: Did it move prematurely?
                        if (central_pawns_idle) {
                            classical_score -= (int)(60 * gamePhase) * color_sign; // Premature development penalty;
                            if (tl_breakdown) tl_breakdown->power_potential -= (int)(60 * gamePhase) * color_sign; // Premature development penalty;
                        } else {
                            // Bonus for safe development
                            bool centralized = (r >= 2 && r <= 5 && fc >= 2 && fc <= 5);
                            if (centralized) classical_score += (int)(25 * gamePhase) * color_sign;
                            if (centralized) if (tl_breakdown) tl_breakdown->power_potential += (int)(25 * gamePhase) * color_sign;
                        }
                    }
                }

                // ---- ROOK ACTIVATION ----
                if (pt == ROOK || pt == PHASE_ROOK || pt == SUMOROOK) {
                    int fc = sq % 8;
                    bool own_pawn = false;
                    bool enemy_pawn = false;
                    for (int r = 0; r < 8; r++) {
                        if (get_bit(b.pieces[c][PAWN] | b.pieces[c][IRONPAWN], r * 8 + fc)) own_pawn = true;
                        if (get_bit(b.pieces[them][PAWN] | b.pieces[them][IRONPAWN], r * 8 + fc)) enemy_pawn = true;
                    }
                    if (!own_pawn && !enemy_pawn) {
                        piece_val += 30; // Fully open file
                    } else if (!own_pawn && enemy_pawn) {
                        piece_val += 15; // Semi-open file
                    }
                    
                    // Centralization bonus for activated Rooks (typical after castling)
                    if (fc == 3 || fc == 4 || fc == 5) {
                        piece_val += 10;
                    }
                }
                
                // Pawn promotion priority when no Pilgrim is alive (to respawn Queen/Rook)
                if ((pt == PAWN || (pt >= GOLDEN_PAWN && pt <= WAR_AUTOMATON)) && popcount(b.pieces[c][PILGRIM]) == 0) {
                    bool has_dead_queen = b.dead_pieces_count[c][QUEEN] > 0;
                    bool has_dead_rook = b.dead_pieces_count[c][ROOK] > 0;
                    
                    if (has_dead_queen || has_dead_rook) {
                        int r = sq / 8;
                        if (c == WHITE) {
                            if (r >= 4) { // Rank 5, 6, 7
                                int advance_bonus = (r - 3) * (has_dead_queen ? 40 : 20);
                                classical_score += advance_bonus * color_sign;
                                if (tl_breakdown) tl_breakdown->power_potential += advance_bonus * color_sign;
                            }
                        } else {
                            if (r <= 3) { // Rank 5, 6, 7 from Black's view (Row 3, 2, 1)
                                int advance_bonus = (4 - r) * (has_dead_queen ? 40 : 20);
                                classical_score += advance_bonus * color_sign;
                                if (tl_breakdown) tl_breakdown->power_potential += advance_bonus * color_sign;
                            }
                        }
                    }
                }
                
                classical_score += piece_val * color_sign;
                if (tl_breakdown) {
                    tl_breakdown->power_potential += piece_val * color_sign;
                    if (pt == KNIGHTMARE) tl_breakdown->km.material += piece_val * color_sign;
                    if (pt == MARAUDER) tl_breakdown->marauder_score += piece_val * color_sign;
                    if (pt == PHASE_ROOK) tl_breakdown->phaserook_score += piece_val * color_sign;
                    if (pt == ELECTROKNIGHT) tl_breakdown->electroknight_score += piece_val * color_sign;
                    if (pt == DJINN) tl_breakdown->djinn_score += piece_val * color_sign;
                }
                
                // PST score
                if (pst_mg != nullptr && pst_eg != nullptr) {
                    // For White, flip the rank to map bottom-up coords to top-down PST array.
                    // For Black, Black's natural perspective is already top-down.
                    int pst_sq = (c == WHITE) ? sq ^ 56 : sq;
                    int mg_pst = pst_mg[pst_sq];
                    int eg_pst = pst_eg[pst_sq];
                    classical_score += (int)((mg_pst * gamePhase) + (eg_pst * (1.0f - gamePhase))) * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += (int)((mg_pst * gamePhase) + (eg_pst * (1.0f - gamePhase))) * color_sign;
                }
            }
        }
        
        // ============================================================
        // ============================================================
        //  PASSED, ISOLATED, AND DOUBLED PAWN DETECTION (O(1) Bitboard)
        //  Massive strategic value in endgames.
        // ============================================================
        {
            U64 our_pawns_all = b.pieces[c][PAWN];
            for (int p_pt = GOLDEN_PAWN; p_pt <= WAR_AUTOMATON; p_pt++)
                our_pawns_all |= b.pieces[c][p_pt];
            U64 enemy_pawns_all = b.pieces[them][PAWN];
            for (int p_pt = GOLDEN_PAWN; p_pt <= WAR_AUTOMATON; p_pt++)
                enemy_pawns_all |= b.pieces[them][p_pt];
            
            U64 tmp_pp = our_pawns_all;
            while (tmp_pp) {
                int psq = pop_lsb(tmp_pp);
                int pr = psq / 8, pf = psq % 8;
                
                // 1. Doubled Pawns
                U64 file_mask = 0x0101010101010101ULL << pf;
                if (popcount(our_pawns_all & file_mask) > 1) {
                    classical_score -= 15 * color_sign; // Penalty for doubled pawns;
                    if (tl_breakdown) tl_breakdown->power_potential -= 15 * color_sign; // Penalty for doubled pawns;
                }
                
                // 2. Isolated Pawns
                U64 adj_files_mask = 0ULL;
                if (pf > 0) adj_files_mask |= (0x0101010101010101ULL << (pf - 1));
                if (pf < 7) adj_files_mask |= (0x0101010101010101ULL << (pf + 1));
                if ((our_pawns_all & adj_files_mask) == 0) {
                    classical_score -= 15 * color_sign; // Penalty for isolated pawns;
                    if (tl_breakdown) tl_breakdown->power_potential -= 15 * color_sign; // Penalty for isolated pawns;
                }
                
                // 3. Passed Pawns
                // Build front span mask: all squares ahead on this file + adjacent files
                U64 block_mask = 0ULL;
                int sr_begin = (c == WHITE) ? pr + 1 : 0;
                int sr_end   = (c == WHITE) ? 8 : pr;
                for (int rr = sr_begin; rr < sr_end; rr++) {
                    if (pf > 0) set_bit(block_mask, rr * 8 + pf - 1);
                    set_bit(block_mask, rr * 8 + pf);
                    if (pf < 7) set_bit(block_mask, rr * 8 + pf + 1);
                }
                if (!(block_mask & enemy_pawns_all)) {
                    // Passed pawn! Scale bonus by proximity to promotion.
                    int dist_to_prom = (c == WHITE) ? (7 - pr) : pr;
                    int passed_bonus = (7 - dist_to_prom) * 20;
                    // Endgame passed pawns are far more valuable
                    classical_score += (int)(passed_bonus * (1.5f - gamePhase * 0.5f)) * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += (int)(passed_bonus * (1.5f - gamePhase * 0.5f)) * color_sign;
                }
            }
            
            // ============================================================
            //  OUTPOST EVALUATION (O(1) Bitboard)
            //  Reward Knights, Electroknights, and Marauders on secure squares.
            // ============================================================
            U64 our_pawn_attacks = 0ULL;
            U64 their_pawn_attacks = 0ULL;
            U64 tmp_our_pawns = our_pawns_all;
            while(tmp_our_pawns) {
                int sq = pop_lsb(tmp_our_pawns);
                our_pawn_attacks |= get_pawn_attacks(sq, (Color)c);
            }
            U64 tmp_their_pawns = enemy_pawns_all;
            while(tmp_their_pawns) {
                int sq = pop_lsb(tmp_their_pawns);
                their_pawn_attacks |= get_pawn_attacks(sq, (Color)them);
            }
            
            U64 central_ranks = 0x0000FFFFFFFF0000ULL; // Ranks 3-6
            U64 outposts = our_pawn_attacks & ~their_pawn_attacks & central_ranks;
            
            U64 knights = b.pieces[c][KNIGHT] | b.pieces[c][ELECTROKNIGHT] | b.pieces[c][MARAUDER] | b.pieces[c][BANKER] | b.pieces[c][CAMEL] | b.pieces[c][FISH_KNIGHT] | b.pieces[c][ANTI_VIOLENCE];
            U64 pieces_on_outposts = knights & outposts;
            classical_score += popcount(pieces_on_outposts) * 20 * color_sign;
            if (tl_breakdown) tl_breakdown->power_potential += popcount(pieces_on_outposts) * 20 * color_sign;

            // Stable Knightmare Outpost Bonus: Massive reward for safely deploying a Knightmare behind pawn cover
            U64 km_on_outposts = b.pieces[c][KNIGHTMARE] & outposts;
            if (km_on_outposts) {
                classical_score += popcount(km_on_outposts) * 75 * color_sign;
                if (tl_breakdown) {
                    tl_breakdown->power_potential += popcount(km_on_outposts) * 75 * color_sign;
                    tl_breakdown->km.outpost += popcount(km_on_outposts) * 75 * color_sign;
                }
            }
            
            // ============================================================
            //  ROOKS ON THE 7TH RANK (O(1) Bitboard)
            //  Classic GM "Pig on the 7th" attacking motif.
            // ============================================================
            U64 rank7_mask = (c == WHITE) ? 0x00FF000000000000ULL : 0x000000000000FF00ULL;
            U64 rooks = b.pieces[c][ROOK] | b.pieces[c][PHASE_ROOK] | b.pieces[c][SUMOROOK];
            U64 pigs_on_7th = rooks & rank7_mask;
            classical_score += popcount(pigs_on_7th) * 25 * color_sign;
            if (tl_breakdown) tl_breakdown->power_potential += popcount(pigs_on_7th) * 25 * color_sign;
        }
        
        // ============================================================
        if (b.has_pixies()) {
        //  PHASE 2: ★ STAR-SYSTEM SAFETY NET (Fix 2)
        //  Uses is_square_attacked() which correctly handles ALL 31 Pixies.
        //  Replaces the old broken QUEEN SAFETY that only checked standard pieces.
        // ============================================================
        
        // ★★★★★★ Critical Asset: -200cp if hanging
        U64 queen_bb = b.pieces[c][QUEEN];
        while (queen_bb) {
            int sq = pop_lsb(queen_bb);
            if (b.is_square_attacked(sq, them)) {
                // If undefended, massive penalty. If defended, still a penalty because trading Queen is usually bad.
                int penalty = b.is_square_attacked(sq, (Color)c) ? 80 : 200;
                classical_score -= penalty * color_sign;
                if (tl_breakdown) tl_breakdown->threats -= penalty * color_sign;
            }
        }

        // ★★★★★ Game-Enders: -150cp if hanging
        const int five_star[] = { FISSION_REACTOR, MARAUDER };
        for (int i = 0; i < 2; i++) {
            U64 pbb = b.pieces[c][five_star[i]];
            while (pbb) {
                int sq = pop_lsb(pbb);
                if (b.is_square_attacked(sq, them)) {
                    int penalty = b.is_square_attacked(sq, (Color)c) ? 50 : 150;
                    classical_score -= penalty * color_sign;
                    if (tl_breakdown) tl_breakdown->threats -= penalty * color_sign;
                }
            }
        }
        
        // ★★★★ High-Threat: -25cp if hanging
        const int four_star[] = { PHASE_ROOK, ROOK, SUMOROOK, BASILISK, ICICLE, ARISTOCRAT, PILGRIM };
        for (int i = 0; i < 7; i++) {
            U64 pbb = b.pieces[c][four_star[i]];
            while (pbb) {
                int sq = pop_lsb(pbb);
                if (b.is_square_attacked(sq, them)) {
                    classical_score -= 25 * color_sign;
                    if (tl_breakdown) tl_breakdown->threats -= 25 * color_sign;
                }
            }
        }
        
        // ★★★ Solid Anchors: -10cp if hanging
        const int three_star[] = { ELECTROKNIGHT, KNIGHTMARE, DANCER, DJINN, CARDINAL, HORDE_MOTHER, 
                                    BLADERUNNER, GUNSLINGER, BISHOP, BOUNCER, BANKER, KNIGHT, CAMEL };
        for (int i = 0; i < 13; i++) {
            U64 pbb = b.pieces[c][three_star[i]];
            while (pbb) {
                int sq = pop_lsb(pbb);
                if (b.is_square_attacked(sq, them)) {
                    classical_score -= 10 * color_sign;
                    if (tl_breakdown) tl_breakdown->threats -= 10 * color_sign;
                }
            }
        }
        
        // ============================================================
        //  ANTI-VIOLENCE SYNERGY (Backup for Power Pieces)
        // ============================================================
        U64 our_av = b.pieces[c][ANTI_VIOLENCE];
        if (our_av) {
            U64 av_aura = 0ULL;
            while(our_av) {
                int avsq = pop_lsb(our_av);
                av_aura |= KING_ATTACKS[avsq];
            }
            U64 high_value = b.pieces[c][BOUNCER] | b.pieces[c][FISSION_REACTOR] | b.pieces[c][MARAUDER] |
                             b.pieces[c][BLADERUNNER] | b.pieces[c][QUEEN] | b.pieces[c][PHASE_ROOK] | b.pieces[c][ELECTROKNIGHT];
            U64 protected_hv = high_value & av_aura;
            int count = popcount(protected_hv);
            classical_score += count * 35 * color_sign;
            if (tl_breakdown) tl_breakdown->power_potential += count * 35 * color_sign;
        }

        // ============================================================
        //  BOUNCER SAFETY PENALTY
        // ============================================================
        U64 bouncers_all = b.pieces[c][BOUNCER];
        U64 enemy_pawns_all = b.pieces[them][PAWN] | b.pieces[them][GOLDEN_PAWN] | b.pieces[them][EPEE_PAWN] | b.pieces[them][PAWN_KNIFE] | b.pieces[them][HERO_PAWN] | b.pieces[them][WAR_AUTOMATON] | b.pieces[them][SHRIKE] | b.pieces[them][WARP_JUMPER] | b.pieces[them][HORDELING];
        while (bouncers_all) {
            int sq = pop_lsb(bouncers_all);
            U64 pawn_attackers = get_pawn_attacks(sq, (Color)c) & enemy_pawns_all;
            if (pawn_attackers && !b.is_square_attacked(sq, (Color)c)) {
                // Attacked by pawn AND undefended (no backup)
                classical_score -= 150 * color_sign;
                if (tl_breakdown) tl_breakdown->threats -= 150 * color_sign;
            }
        }

        // ============================================================
        //  HIGH-VALUE SACRIFICE PREVENTION
        // ============================================================
        U64 high_value_all = b.pieces[c][KNIGHT] | b.pieces[c][FISH_KNIGHT] | b.pieces[c][BANKER] | b.pieces[c][CAMEL] |
                             b.pieces[c][BISHOP] | b.pieces[c][BOUNCER] | b.pieces[c][ROOK] | b.pieces[c][PHASE_ROOK] |
                             b.pieces[c][SUMOROOK] | b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR] |
                             b.pieces[c][ELECTROKNIGHT] | b.pieces[c][KNIGHTMARE] | b.pieces[c][BASILISK] |
                             b.pieces[c][ICICLE] | b.pieces[c][MARAUDER] | b.pieces[c][ARISTOCRAT] | b.pieces[c][PILGRIM] |
                             b.pieces[c][BLADERUNNER] | b.pieces[c][DJINN] | b.pieces[c][CARDINAL] | b.pieces[c][HORDE_MOTHER];
                             
        while (high_value_all) {
            int sq = pop_lsb(high_value_all);
            int piece_pt = b.get_piece_on_square(sq);
            int piece_val = PIECE_VALUES[piece_pt];
            
            // Check the lowest-value enemy attacker
            Board::AttackerInfo min_attacker = b.get_smallest_attacker(sq, (Color)them);
            if (min_attacker.piece_type != PIECE_TYPE_NONE && min_attacker.piece_type != KING) {
                int attacker_val = PIECE_VALUES[min_attacker.piece_type];
                
                if (attacker_val < piece_val - 200) {
                    // Massive penalty for allowing a strictly lower-value piece to attack our high-value piece!
                    // Even if it's defended, trading a Queen (1050) for a Knight (320) is a catastrophic failure.
                    classical_score -= 300 * color_sign;
                    if (tl_breakdown) tl_breakdown->threats -= 300 * color_sign;
                }
            }
        }
        
        // ============================================================
        //  PHASE 2B: MISSING PIECE POSITIONAL EVALUATION
        // ============================================================
        
        // ANTI_VIOLENCE: Bonus for central placement (blocks enemy captures in a wider area)
        U64 anti_v = b.pieces[c][ANTI_VIOLENCE];
        while (anti_v) {
            int sq = pop_lsb(anti_v);
            int r = sq / 8, fc = sq % 8;
            if ((r >= 2 && r <= 5) && (fc >= 2 && fc <= 5)) {
                classical_score += 30 * color_sign; // Central aura is more impactful;
                if (tl_breakdown) tl_breakdown->power_potential += 30 * color_sign; // Central aura is more impactful;
            }
            // Count how many enemy pieces are in the aura
            U64 aura = KING_ATTACKS[sq] & b.occupancies[them];
            classical_score += popcount(aura) * 15 * color_sign;
            if (tl_breakdown) tl_breakdown->threats += popcount(aura) * 15 * color_sign;
        }
        
        // BANKER: Bonus for each enemy pawn in knight-jump range (can bank/steal them)
        U64 bankers = b.pieces[c][BANKER];
        while (bankers) {
            int sq = pop_lsb(bankers);
            U64 targets = KNIGHT_ATTACKS[sq] & b.pieces[them][PAWN];
            // Also count pixie pawns
            for (int pt = GOLDEN_PAWN; pt <= WAR_AUTOMATON; pt++) {
                targets |= KNIGHT_ATTACKS[sq] & b.pieces[them][pt];
            }
            int pawn_count = popcount(targets);
            classical_score += pawn_count * 50 * color_sign;
            if (tl_breakdown) tl_breakdown->threats += pawn_count * 50 * color_sign;
        }
        
        // CAMEL: Mobility bonus (3,1 leaper has unique reach)
        U64 camels = b.pieces[c][CAMEL];
        while (camels) {
            int sq = pop_lsb(camels);
            int r = sq / 8, fc = sq % 8;
            // Camel attacks: (3,1) and (1,3) jumps
            int camel_mobility = 0;
            int camel_offsets[][2] = {{-3,-1},{-3,1},{-1,-3},{-1,3},{1,-3},{1,3},{3,-1},{3,1}};
            for (int i = 0; i < 8; i++) {
                int nr = r + camel_offsets[i][0], nc = fc + camel_offsets[i][1];
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                    int nsq = nr * 8 + nc;
                    if (!get_bit(b.occupancies[c], nsq)) camel_mobility++;
                }
            }
            classical_score += camel_mobility * 5 * color_sign;
            if (tl_breakdown) tl_breakdown->mobility += camel_mobility * 5 * color_sign;
        }
        
        // IRONPAWN: Bonus for invulnerability — safe advanced pawn
        U64 ironpawns = b.pieces[c][IRONPAWN];
        while (ironpawns) {
            int sq = pop_lsb(ironpawns);
            int rank = sq / 8;
            int advancement = (c == WHITE) ? rank : (7 - rank);
            classical_score += advancement * 10 * color_sign; // More valuable as it advances;
            if (tl_breakdown) tl_breakdown->mobility += advancement * 10 * color_sign; // More valuable as it advances;
        }
        
        // FISH_KNIGHT: Bonus if it just moved (earns a bonus king-step)
        U64 fish_kn = b.pieces[c][FISH_KNIGHT];
        while (fish_kn) {
            int sq = pop_lsb(fish_kn);
            // Center control bonus
            int r = sq / 8, fc = sq % 8;
            if (r >= 2 && r <= 5 && fc >= 2 && fc <= 5) {
                classical_score += 15 * color_sign;
                if (tl_breakdown) tl_breakdown->center_control += 15 * color_sign;
            }
        }
        
        // ============================================================
        //  DANCER: Check-for-Bonus-Moves Strategy
        //  Ability: Giving CHECK earns 2 non-capturing bonus moves next turn.
        //  Strategy: Reward diagonal positioning toward enemy King.
        //  A Dancer threatening check is far more valuable than its base material.
        // ============================================================
        U64 dancers = b.pieces[c][DANCER];
        while (dancers) {
            int dsq = pop_lsb(dancers);
            int dr = dsq / 8, dc = dsq % 8;
            
            // 1. If currently in bonus-move mode (already gave check), massive bonus
            //    — the engine earned it and should fully exploit the free moves
            int bonus_moves = b.ability_tracker[dsq].dancer_bonus_moves;
            if (bonus_moves > 0) {
                // Actively using bonus moves = huge positional advantage
                classical_score += (int)(180 * gamePhase) * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += (int)(180 * gamePhase) * color_sign;
            }
            
            // 2. Reward Dancer for being diagonally aligned with enemy King
            //    (i.e., it can potentially give check next move)
            U64 enemy_king_bb = b.pieces[them][KING];
            if (enemy_king_bb) {
                int ksq = get_lsb(enemy_king_bb);
                int kr = ksq / 8, kc = ksq % 8;
                bool on_check_diagonal = (std::abs(dr - kr) == std::abs(dc - kc));
                if (on_check_diagonal) {
                    // Dancer is aligned — check is a single move away
                    classical_score += (int)(100 * gamePhase) * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += (int)(100 * gamePhase) * color_sign;
                }
                
                // 3. Proximity bonus: closer to enemy King = more dangerous diagonals available
                int dist = std::max(std::abs(dr - kr), std::abs(dc - kc));
                if (dist <= 4) {
                    // Within striking distance — can give check in 1-2 moves
                    int proximity_bonus = (5 - dist) * 15;
                    classical_score += (int)(proximity_bonus * gamePhase) * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += (int)(proximity_bonus * gamePhase) * color_sign;
                }
            }
            
            // 4. Penalize Dancer for staying on back rank during opening/mid (wasted check potential)
            if (gamePhase > 0.6f) {
                bool on_back_rank = (c == WHITE) ? (dr <= 1) : (dr >= 6);
                if (on_back_rank) {
                    classical_score -= (int)(40 * gamePhase) * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential -= (int)(40 * gamePhase) * color_sign;
                }
            }
        }
        
        // ============================================================
        //  PILGRIM PRESERVATION & EARLY ACTIVITY
        //  The Pilgrim is the ONLY piece that can resurrect captured pieces.
        //  Its survival is paramount. Move it early to accumulate distance
        //  so it's ready to respawn major pieces immediately upon capture.
        // ============================================================
        {
            bool pilgrim_alive = b.pieces[c][PILGRIM] != 0;
            
            if (pilgrim_alive) {
                // Base survival bonus: having a Pilgrim alive is inherently valuable
                // because it acts as "insurance" against losing major pieces.
                classical_score += 200 * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += 200 * color_sign;
                
                U64 pil = b.pieces[c][PILGRIM];
                while (pil) {
                    int psq = pop_lsb(pil);
                    int pr = psq / 8;
                    
                    // Back-rank penalty: Pilgrim sitting on starting ranks is wasted.
                    // It should be moving to accumulate distance for future respawns.
                    bool on_back = (c == WHITE) ? (pr <= 1) : (pr >= 6);
                    if (on_back && gamePhase > 0.5f) {
                        classical_score -= (int)(80 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential -= (int)(80 * gamePhase) * color_sign;
                    }
                    
                    // Pre-emptive distance accumulation bonus (even before any piece dies).
                    // Every square the Pilgrim moves is "banked" for future resurrections.
                    if (!b.ability_tracker[psq].ability_used) {
                        int dist = b.ability_tracker[psq].pilgrim_dist;
                        if (dist > 0) {
                            // Base distance bonus: reward movement even when no piece is dead yet
                            classical_score += std::min(dist * 5, 80) * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential += std::min(dist * 5, 80) * color_sign;
                        }
                    }
                    
                    // Safety bonus: Pilgrim is defended by our own pieces
                    if (b.is_square_attacked(psq, (Color)c)) {
                        classical_score += 30 * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += 30 * color_sign;
                    }
                    
                    // Danger penalty: Pilgrim is attacked by enemy
                    if (b.is_square_attacked(psq, them)) {
                        if (!b.is_square_attacked(psq, (Color)c)) {
                            // Hanging Pilgrim! Massive penalty — losing it means no respawns ever.
                            classical_score -= 350 * color_sign;
                            if (tl_breakdown) tl_breakdown->threats -= 350 * color_sign;
                        } else {
                            // Attacked but defended — still dangerous, minor penalty
                            classical_score -= 60 * color_sign;
                            if (tl_breakdown) tl_breakdown->threats -= 60 * color_sign;
                        }
                    }
                }
            } else {
                // Pilgrim is DEAD. This is a strategic disaster.
                // Penalize to make the engine fight harder to avoid this state.
                classical_score -= 150 * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential -= 150 * color_sign;
            }
        }

        U64 sumorooks = b.pieces[c][SUMOROOK];
        while (sumorooks) {
            int sq = pop_lsb(sumorooks);
            int r = sq / 8, fc = sq % 8;
            
            // SumoRook Shield Penalty
            // Pawns directly in front of a SumoRook are critical for maintaining its pushing lane.
            // If such a pawn is attacked by the enemy and completely undefended by us, penalize heavily!
            int pawn_r = r + (c == WHITE ? 1 : -1);
            if (pawn_r >= 0 && pawn_r <= 7) {
                int pawn_sq = pawn_r * 8 + fc;
                int piece_in_front = b.get_piece_on_square(pawn_sq);
                if (piece_in_front != PIECE_TYPE_NONE && (get_bit(b.pieces[c][PAWN], pawn_sq) || piece_in_front <= WAR_AUTOMATON)) {
                    // Check if the pawn is attacked by the enemy
                    if (b.is_square_attacked(pawn_sq, (Color)them)) {
                        // The SumoRook itself cannot capture, so we must exclude it from our defenders check!
                        // Temporarily remove the SumoRook from the occupancies to see if ANY OTHER piece defends the pawn.
                        Board* mut_b = const_cast<Board*>(&b);
                        clear_bit(mut_b->pieces[c][SUMOROOK], sq);
                        clear_bit(mut_b->occupancies[c], sq);
                        clear_bit(mut_b->occupancies[BOTH], sq);
                        
                        bool defended_by_other = mut_b->is_square_attacked(pawn_sq, (Color)c);
                        
                        set_bit(mut_b->pieces[c][SUMOROOK], sq);
                        set_bit(mut_b->occupancies[c], sq);
                        set_bit(mut_b->occupancies[BOTH], sq);
                        
                        if (!defended_by_other) {
                            classical_score -= 300 * color_sign; // Massive penalty for hanging the shield pawn!
                            if (tl_breakdown) tl_breakdown->king_safety -= 300 * color_sign;
                        }
                    }
                }
            }
            
            // SumoRook Aggressive Deployment (from move 1)
            // The SumoRook MUST come out early to dominate.
            {
                // Penalize only if strictly on the back rank. Pushing to Rank 2 counts as active deployment!
                bool on_start = (c == WHITE) ? (r == 0) : (r == 7);
                if (on_start) {
                    // Heavy back-rank penalty forces the engine to deploy it ASAP
                    classical_score -= 120 * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential -= 120 * color_sign;
                } else {
                    // Deployed! Big bonus for being active
                    classical_score += 200 * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += 200 * color_sign;
                }
            }
            
            // SumoRook King Alignment Bonus
            U64 enemy_king_bb = b.pieces[them][KING];
            if (enemy_king_bb) {
                int ek_sq = get_lsb(enemy_king_bb);
                int ek_r = ek_sq / 8;
                int ek_c = ek_sq % 8;
                
                if (r == ek_r || fc == ek_c) {
                    int dist_to_edge = 99;
                    if (r == ek_r) {
                        if (fc < ek_c) dist_to_edge = 7 - ek_c; // Push right
                        else dist_to_edge = ek_c; // Push left
                    } else {
                        if (r < ek_r) dist_to_edge = 7 - ek_r; // Push up
                        else dist_to_edge = ek_r; // Push down
                    }
                    
                    if (dist_to_edge <= 1) {
                        classical_score += 250 * color_sign;
                        if (tl_breakdown) tl_breakdown->king_safety += 250 * color_sign;
                    }
                }
            }
            
            // Projectile Bonus: A pawn directly in front of a DEVELOPED Sumorook is highly valuable!
            // We restrict standard pawns to developed Sumorooks to prevent them from anchoring to their starting pawns.
            bool on_start_row = (c == WHITE) ? (r <= 1) : (r >= 6);
            int forward_r = r + (c == WHITE ? 1 : -1);
            if (forward_r >= 0 && forward_r < 8) {
                int front_sq = forward_r * 8 + fc;
                // Standard pawn projectile bonus (only if developed)
                if (!on_start_row && get_bit(b.pieces[c][PAWN], front_sq)) {
                    classical_score += 150 * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += 150 * color_sign;
                }
                
                // Epee-Sumo "Loaded Gun" Synergy Bonus
                // An Epee Pawn in front of a SumoRook is a massive threat because it can En-Passant teleport away!
                // We reward this EVEN IF on the starting row.
                if (get_bit(b.pieces[c][EPEE_PAWN], front_sq)) {
                    classical_score += 250 * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += 250 * color_sign;
                }
            }
            
            // 4 push directions: UP, DOWN, LEFT, RIGHT
            int dirs[4][2] = {{1,0}, {-1,0}, {0,1}, {0,-1}};
            for (int i = 0; i < 4; i++) {
                int dr = dirs[i][0];
                int dc = dirs[i][1];
                int cur_r = r + dr;
                int cur_c = fc + dc;
                
                // Find first piece in ray
                int hit_sq = -1;
                while (cur_r >= 0 && cur_r < 8 && cur_c >= 0 && cur_c < 8) {
                    int check_sq = cur_r * 8 + cur_c;
                    if (get_bit(b.occupancies[BOTH], check_sq)) {
                        hit_sq = check_sq;
                        break;
                    }
                    cur_r += dr;
                    cur_c += dc;
                }
                
                if (hit_sq != -1) {
                    int p1_type = b.get_piece_on_square(hit_sq);
                    if (p1_type == IRONPAWN) continue; // Cannot push Ironpawns
                    
                    // High-Value Target Tracking (Clear Path)
                    bool is_enemy = get_bit(b.occupancies[them], hit_sq);
                    if (is_enemy && (p1_type == KING || p1_type == QUEEN || p1_type == FISSION_REACTOR)) {
                        classical_score += 300 * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += 300 * color_sign;
                    }
                    
                    // High-Value Target Tracking (Blocked by Epee Pawn)
                    bool is_our_epee = get_bit(b.pieces[c][EPEE_PAWN], hit_sq);
                    
                    // CHECK IF PUSH IS VALID
                    int next_r = cur_r + dr;
                    int next_c = cur_c + dc;
                    bool push_valid = true;
                    int hit2_sq = -1;
                    
                    // Does a second piece exist?
                    while (next_r >= 0 && next_r < 8 && next_c >= 0 && next_c < 8) {
                        int check2_sq = next_r * 8 + next_c;
                        if (get_bit(b.occupancies[BOTH], check2_sq)) {
                            hit2_sq = check2_sq;
                            break;
                        }
                        next_r += dr;
                        next_c += dc;
                    }
                    
                    if (is_our_epee && hit2_sq != -1) {
                        int p2_type = b.get_piece_on_square(hit2_sq);
                        bool is_enemy2 = get_bit(b.occupancies[them], hit2_sq);
                        if (is_enemy2 && (p2_type == KING || p2_type == QUEEN || p2_type == FISSION_REACTOR)) {
                            // Epee Pawn is the ONLY piece blocking a direct attack on a high value target!
                            // "Loaded Gun" sniper setup.
                            classical_score += 300 * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential += 300 * color_sign;
                        }
                    }
                    
                    // If second piece is immediately behind the first piece, check third square
                    if (hit2_sq != -1 && (hit2_sq == (cur_r + dr) * 8 + (cur_c + dc))) {
                        int third_r = next_r + dr;
                        int third_c = next_c + dc;
                        if (third_r >= 0 && third_r < 8 && third_c >= 0 && third_c < 8) {
                            int third_sq = third_r * 8 + third_c;
                            if (get_bit(b.occupancies[BOTH], third_sq)) {
                                push_valid = false; // Blocked by third piece!
                            }
                        }
                    }
                    
                    if (push_valid) {
                        bool p1_is_ours = get_bit(b.occupancies[c], hit_sq);
                        
                        // Knockout Threat (The Loaded Gun)
                        if (p1_type == KING && !p1_is_ours) {
                            int king_r = hit_sq / 8;
                            int king_c = hit_sq % 8;
                            int dist_to_falloff = (dr != 0) ? (dr > 0 ? 7 - king_r : king_r) : (dc > 0 ? 7 - king_c : king_c);
                            
                            if (dist_to_falloff == 0) {
                                classical_score += 900 * color_sign;
                                if (tl_breakdown) tl_breakdown->king_safety += 900 * color_sign;
                            } else {
                                int bonus = (6 - dist_to_falloff) * 100;
                                if (bonus > 0) {
                                    classical_score += bonus * color_sign;
                                    if (tl_breakdown) tl_breakdown->king_safety += bonus * color_sign;
                                }
                            }
                        }
                        
                        // 3. Double-Push Disruption
                        bool is_double_push = (hit2_sq != -1 && (hit2_sq == (cur_r + dr) * 8 + (cur_c + dc)));
                        if (is_double_push && !p1_is_ours) {
                            // Only give disruption bonus if we are pushing ENEMY pieces
                            // If we push our own pieces, we rely on the search tree to find the value
                            classical_score += 40 * color_sign; // Disruption bonus;
                            if (tl_breakdown) tl_breakdown->power_potential += 40 * color_sign; // Disruption bonus;
                        }
                    }
                }
            }
        }
        
        // 4. Enemy SumoRook Avoidance & Trapping Strategy
        U64 enemy_sumorooks = b.pieces[them][SUMOROOK];
        while (enemy_sumorooks) {
            int sq = pop_lsb(enemy_sumorooks);
            int r = sq / 8, fc = sq % 8;
            
            // Trapping Strategy: Count empty adjacent squares for the enemy SumoRook
            int empty_adjacent = 0;
            int adj_dirs[4][2] = {{1,0}, {-1,0}, {0,1}, {0,-1}};
            for (int i = 0; i < 4; i++) {
                int ar = r + adj_dirs[i][0];
                int ac = fc + adj_dirs[i][1];
                if (ar >= 0 && ar < 8 && ac >= 0 && ac < 8) {
                    if (!get_bit(b.occupancies[BOTH], ar * 8 + ac)) {
                        empty_adjacent++;
                    }
                }
            }
            
            // If the enemy SumoRook is restricted (0 or 1 empty squares)
            if (empty_adjacent <= 1) {
                classical_score += 100 * color_sign; // Positional bonus for restricting it
                if (tl_breakdown) tl_breakdown->power_potential += 100 * color_sign;
                
                // If we are actively aiming an attack at the restricted SumoRook, reward it!
                // Capped at 50 to prevent suicidal sacrifices just to apply a temporary threat.
                if (b.is_square_attacked(sq, (Color)c)) {
                    classical_score += 50 * color_sign; // Trapping bonus!
                    if (tl_breakdown) tl_breakdown->power_potential += 50 * color_sign;
                }
            }
            
            int dirs[4][2] = {{1,0}, {-1,0}, {0,1}, {0,-1}};
            for (int i = 0; i < 4; i++) {
                int dr = dirs[i][0];
                int dc = dirs[i][1];
                int cur_r = r + dr;
                int cur_c = fc + dc;
                
                int hit_sq = -1;
                while (cur_r >= 0 && cur_r < 8 && cur_c >= 0 && cur_c < 8) {
                    int check_sq = cur_r * 8 + cur_c;
                    if (get_bit(b.occupancies[BOTH], check_sq)) {
                        hit_sq = check_sq;
                        break;
                    }
                    cur_r += dr;
                    cur_c += dc;
                }
                
                if (hit_sq != -1) {
                    int p1_type = b.get_piece_on_square(hit_sq);
                    if (p1_type == IRONPAWN) continue; // Cannot push Ironpawns
                    
                    int next_r = cur_r + dr;
                    int next_c = cur_c + dc;
                    bool push_valid = true;
                    int hit2_sq = -1;
                    
                    while (next_r >= 0 && next_r < 8 && next_c >= 0 && next_c < 8) {
                        int check2_sq = next_r * 8 + next_c;
                        if (get_bit(b.occupancies[BOTH], check2_sq)) {
                            hit2_sq = check2_sq;
                            break;
                        }
                        next_r += dr;
                        next_c += dc;
                    }
                    
                    if (hit2_sq != -1 && (hit2_sq == (cur_r + dr) * 8 + (cur_c + dc))) {
                        int third_r = next_r + dr;
                        int third_c = next_c + dc;
                        if (third_r >= 0 && third_r < 8 && third_c >= 0 && third_c < 8) {
                            int third_sq = third_r * 8 + third_c;
                            if (get_bit(b.occupancies[BOTH], third_sq)) {
                                push_valid = false;
                            }
                        }
                    }
                    
                    if (push_valid && get_bit(b.occupancies[c], hit_sq)) {
                        // Our piece is the first target of an enemy SumoRook AND push is valid!
                        int p_type = b.get_piece_on_square(hit_sq);
                        int p_val = PIECE_VALUES[p_type];
                        
                        // Check if the push will send our piece off the board!
                        bool falls_off_board = false;
                        if (hit2_sq != -1) {
                            // If there's a second piece, the second piece is pushed.
                            // Does the second piece fall off?
                            int third_r = next_r + dr;
                            int third_c = next_c + dc;
                            if (third_r < 0 || third_r > 7 || third_c < 0 || third_c > 7) {
                                // If the second piece is ours, it falls off!
                                if (get_bit(b.occupancies[c], hit2_sq)) {
                                    int p2_type = b.get_piece_on_square(hit2_sq);
                                    int penalty = PIECE_VALUES[p2_type] * 2;
                                    if (p2_type == KING) penalty = 10000; // MUST AVOID!
                                    classical_score -= penalty * color_sign;
                                    if (tl_breakdown) tl_breakdown->power_potential -= penalty * color_sign;
                                }
                            }
                            // The first piece is just pushed one square safely. Apply a smaller positional penalty.
                            int penalty = p_val / 5;
                            if (penalty < 30) penalty = 30;
                            classical_score -= penalty * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential -= penalty * color_sign;
                            
                        } else {
                            // No second piece. The first piece is pushed directly.
                            if (next_r < 0 || next_r > 7 || next_c < 0 || next_c > 7) {
                                falls_off_board = true;
                            }
                            
                            if (falls_off_board) {
                                // Instant death! Massive penalty!
                                int penalty = p_val * 2; // Double its value!
                                if (p_type == KING) penalty = 10000; // ABSOLUTE MUST AVOID!
                                classical_score -= penalty * color_sign;
                                if (tl_breakdown) tl_breakdown->power_potential -= penalty * color_sign;
                            } else {
                                // Positional danger.
                                int penalty = p_val / 5;
                                if (penalty < 30) penalty = 30;
                                classical_score -= penalty * color_sign;
                                if (tl_breakdown) tl_breakdown->power_potential -= penalty * color_sign;
                            }
                        }
                    }
                }
            }
        }
        // BASILISK: Paralyzing the King is a huge advantage!
        U64 basilisks = b.pieces[c][BASILISK];
        while (basilisks) {
            int sq = pop_lsb(basilisks);
            U64 attacks = get_sliding_attacks(sq, b.occupancies[BOTH], true, false);
            U64 enemy_king = b.pieces[them][KING];
            if (attacks & enemy_king) {
                // Massive bonus for paralyzing the enemy King
                classical_score += 300 * color_sign;
                if (tl_breakdown) tl_breakdown->king_safety += 300 * color_sign;
            }
            
            // Trap Strategy: Bonus for paralyzing other enemy pieces
            U64 paralyzed_enemies = attacks & b.occupancies[them];
            while (paralyzed_enemies) {
                int p_sq = pop_lsb(paralyzed_enemies);
                int p_type = PIECE_TYPE_NONE;
                for (int t = 0; t < PIECE_TYPE_COUNT; t++) {
                    if (get_bit(b.pieces[them][t], p_sq)) {
                        p_type = t;
                        break;
                    }
                }
                if (p_type != PIECE_TYPE_NONE && p_type != KING) {
                    // Base bonus is 5% of the paralyzed piece's value, absolutely capped at 40 points
                    int trap_bonus = std::min(PIECE_VALUES[p_type] / 20, 40);
                    
                    // Overextension Penalty: If the paralyzed enemy piece is in our territory, double the bonus!
                    int p_rank = p_sq / 8;
                    bool in_our_territory = (c == WHITE) ? (p_rank < 4) : (p_rank > 3);
                    if (in_our_territory) {
                        trap_bonus *= 2; // Max 80 points total
                    }
                    
                    classical_score += trap_bonus * color_sign;
                    if (tl_breakdown) tl_breakdown->king_safety += trap_bonus * color_sign;
                }
            }
        }
        
        // CARDINAL: Small mobility bonus for backward step ability
        U64 card = b.pieces[c][CARDINAL];
        while (card) {
            int sq = pop_lsb(card);
            int back = (c == WHITE) ? (sq - 8) : (sq + 8);
            if (back >= 0 && back < 64 && !get_bit(b.occupancies[BOTH], back)) {
                classical_score += 10 * color_sign; // Can retreat;
                if (tl_breakdown) tl_breakdown->mobility += 10 * color_sign; // Can retreat;
            }
        }

        // ============================================================
        //  PHASE 2C: ⚡ SYNERGY DETECTION LAYER (Principle 8)
        //  Rewards combinations of power pieces that create compounding
        //  threats beyond what individual piece evaluation captures.
        //  Uses only bitboard arithmetic — ZERO NPS impact.
        // ============================================================

        // --- SYNERGY 1: Basilisk + Marauder (Freeze & Execute) ---
        // If we have BOTH alive, and Basilisk's diagonal ray hits the enemy King,
        // AND Marauder is within 3 squares of that King → lethal combo
        {
            U64 our_basilisk = b.pieces[c][BASILISK];
            U64 our_marauder = b.pieces[c][MARAUDER];
            U64 enemy_king   = b.pieces[them][KING];
            if (our_basilisk && our_marauder && enemy_king) {
                int ksq = get_lsb(enemy_king);
                int kr = ksq / 8, kc = ksq % 8;
                // Check if any Basilisk is on same diagonal as enemy King
                U64 temp_bas = our_basilisk;
                bool basilisk_on_king_diag = false;
                while (temp_bas) {
                    int bsq = pop_lsb(temp_bas);
                    int br = bsq / 8, bc = bsq % 8;
                    if (std::abs(br - kr) == std::abs(bc - kc)) {
                        basilisk_on_king_diag = true;
                        break;
                    }
                }
                // Check if any Marauder is within 3 Chebyshev squares of King
                U64 temp_mar = our_marauder;
                bool marauder_near_king = false;
                while (temp_mar) {
                    int msq = pop_lsb(temp_mar);
                    int mr = msq / 8, mc = msq % 8;
                    int dist = std::max(std::abs(mr - kr), std::abs(mc - kc));
                    if (dist <= 3) { marauder_near_king = true; break; }
                }
                if (basilisk_on_king_diag && marauder_near_king) {
                    classical_score += (int)(100 * gamePhase) * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += (int)(100 * gamePhase) * color_sign;
                }
            }
        }

        // --- SYNERGY 2: Basilisk + Queen/Reactor (Paralysis + Firepower) ---
        // If Basilisk is on same diagonal as enemy King AND we have an active Queen/Reactor
        // that has mobility → devastating coordinated pressure
        {
            U64 our_basilisk = b.pieces[c][BASILISK];
            U64 our_queen    = b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR];
            U64 enemy_king   = b.pieces[them][KING];
            if (our_basilisk && our_queen && enemy_king) {
                int ksq = get_lsb(enemy_king);
                int kr = ksq / 8, kc = ksq % 8;
                U64 temp_bas = our_basilisk;
                bool basilisk_aligned = false;
                while (temp_bas) {
                    int bsq = pop_lsb(temp_bas);
                    int br = bsq / 8, bc = bsq % 8;
                    if (std::abs(br - kr) == std::abs(bc - kc)) {
                        basilisk_aligned = true;
                        break;
                    }
                }
                if (basilisk_aligned) {
                    // Extra bonus if the Queen/Reactor also has line-of-sight toward King
                    U64 temp_q = our_queen;
                    while (temp_q) {
                        int qsq = pop_lsb(temp_q);
                        int qr = qsq / 8, qc = qsq % 8;
                        bool same_rank = (qr == kr);
                        bool same_file = (qc == kc);
                        bool same_diag = (std::abs(qr - kr) == std::abs(qc - kc));
                        if (same_rank || same_file || same_diag) {
                            classical_score += (int)(90 * gamePhase) * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential += (int)(90 * gamePhase) * color_sign;
                        }
                    }
                }
            }
        }

        // --- SYNERGY 3: Nuclear Strike — Reactor(4 caps) + Paralyzed/Near King ---
        // If Fission Reactor has 4 captures and enemy King is within blast+1 range → NUKE IMMINENT
        {
            U64 reactors = b.pieces[c][FISSION_REACTOR];
            U64 enemy_king = b.pieces[them][KING];
            while (reactors && enemy_king) {
                int fsq = pop_lsb(reactors);
                int captures = b.ability_tracker[fsq].fission_captures;
                if (captures >= 4) {
                    int ksq = get_lsb(enemy_king);
                    int fr = fsq / 8, fc2 = fsq % 8;
                    int kr = ksq / 8, kc = ksq % 8;
                    int dist = std::max(std::abs(fr - kr), std::abs(fc2 - kc));
                    if (dist <= 2) {
                        // King is in or adjacent to blast radius — nuclear strike imminent!
                        classical_score += (int)(400 * gamePhase) * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += (int)(400 * gamePhase) * color_sign;
                    }
                }
            }
        }

        // --- SYNERGY 4: Horde Swarm Threat ---
        // Horde Mother alive + 3+ Hordelings in play = avalanche threat
        {
            U64 mother = b.pieces[c][HORDE_MOTHER];
            U64 hordelings = b.pieces[c][HORDELING];
            if (mother && popcount(hordelings) >= 3) {
                // Swarm is fully operational — massive territorial threat
                int swarm_bonus = popcount(hordelings) * 25;
                classical_score += swarm_bonus * color_sign;
                if (tl_breakdown) tl_breakdown->threats += swarm_bonus * color_sign;
                // Extra if Mother is in the middlegame and Hordelings are advanced
                U64 temp_h = hordelings;
                int advanced_hordelings = 0;
                while (temp_h) {
                    int hsq = pop_lsb(temp_h);
                    int hr = hsq / 8;
                    bool advanced = (c == WHITE) ? (hr >= 3) : (hr <= 4);
                    if (advanced) advanced_hordelings++;
                }
                classical_score += advanced_hordelings * 20 * color_sign;
                if (tl_breakdown) tl_breakdown->threats += advanced_hordelings * 20 * color_sign;
            }
        }

        // --- SYNERGY 5: Icicle + Marauder Pincer (Freeze & Kill) ---
        // If Icicle has frozen an enemy piece AND Marauder is within 2 squares of it → guaranteed kill
        {
            U64 our_icicle   = b.pieces[c][ICICLE];
            U64 our_marauder = b.pieces[c][MARAUDER];
            if (our_icicle && our_marauder) {
                // Build a bitboard of frozen enemy squares using the cached frozen_pieces bitboard
                U64 frozen_enemy = b.frozen_pieces & b.occupancies[them];
                if (frozen_enemy) {
                    U64 temp_mar = our_marauder;
                    while (temp_mar) {
                        int msq = pop_lsb(temp_mar);
                        int mr = msq / 8, mc = msq % 8;
                        U64 temp_f = frozen_enemy;
                        while (temp_f) {
                            int frsq = pop_lsb(temp_f);
                            int frozr = frsq / 8, frozc = frsq % 8;
                            int dist = std::max(std::abs(mr - frozr), std::abs(mc - frozc));
                            if (dist <= 2) {
                                int frozen_type = b.get_piece_on_square(frsq);
                                // Cap freeze bonus to 10% of the frozen piece's value, max 80 points
                                // This prevents suicidal Icicle sacrifices just for temporary freezes.
                                int kill_bonus = (frozen_type < PIECE_TYPE_COUNT) ?
                                    std::min(PIECE_VALUES[frozen_type] / 10, 80) : 20;
                                classical_score += kill_bonus * color_sign;
                                if (tl_breakdown) tl_breakdown->power_potential += kill_bonus * color_sign;
                            }
                        }
                    }
                }
            }
        }

        // --- SYNERGY 6: Phase Rook + Queen Battery (Double Line Threat) ---
        // If Phase Rook and Queen/Fission Reactor share the same rank OR file → double battery
        {
            U64 phase_rooks = b.pieces[c][PHASE_ROOK];
            U64 queens      = b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR];
             U64 enemy_king  = b.pieces[them][KING];
            if (phase_rooks && queens && enemy_king) {
                int ksq = get_lsb(enemy_king);
                int kr = ksq / 8, kc = ksq % 8;
                U64 temp_pr = phase_rooks;
                while (temp_pr) {
                    int prsq = pop_lsb(temp_pr);
                    int prr = prsq / 8, prc = prsq % 8;
                    U64 temp_q = queens;
                    while (temp_q) {
                        int qsq2 = pop_lsb(temp_q);
                        int qr2 = qsq2 / 8, qc2 = qsq2 % 8;
                        bool battery_rank = (prr == qr2) && (prr == kr); // Same rank as King
                        bool battery_file = (prc == qc2) && (prc == kc); // Same file as King
                        if (battery_rank || battery_file) {
                            classical_score += 80 * color_sign;
                            if (tl_breakdown) tl_breakdown->king_safety += 80 * color_sign;
                        }
                    }
                }
            }
        }

        // --- SYNERGY 7: Queen + Marauder (Long Game Dominance) ---
        // If we have a Queen and a fed Marauder, they are a devastating duo.
        // We apply a massive constant bonus just for keeping them both on the board,
        // which forces the Bot to avoid sacrificing either piece.
        {
            U64 our_queens = b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR];
            U64 our_marauders = b.pieces[c][MARAUDER];
            if (our_queens && our_marauders) {
                // Base synergy just for having both (Massive: worth more than a Queen!)
                // This mathematically guarantees it will never trade them for material.
                int synergy_bonus = 1200; 
                
                // Add huge bonuses based on the Marauder's kill count (range)
                U64 temp_mar = our_marauders;
                while (temp_mar) {
                    int msq = pop_lsb(temp_mar);
                    int kills = b.ability_tracker[msq].marauder_kills;
                    if (kills > 0) {
                        // Exponentially massive synergy for a fed Marauder + Queen
                        // +1000 per kill makes trading them equivalent to losing a full Queen for nothing.
                        // It will ONLY sacrifice them to avoid Checkmate or force Checkmate.
                        synergy_bonus += kills * 1000; 
                    }
                }
                
                classical_score += synergy_bonus * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += synergy_bonus * color_sign;
            }
        }

        } // End of if (b.has_pixies()) for Phase 2 blocks

        // ============================================================
        //  PHASE 3: QUEEN / FISSION REACTOR MOBILITY BONUS
        // ============================================================
        U64 q2 = b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR];
        while (q2) {
            int qsq = pop_lsb(q2);
            U64 occ = b.occupancies[BOTH];
            U64 q_moves = get_sliding_attacks(qsq, occ, true, true);
            q_moves &= ~b.occupancies[c]; // Remove squares occupied by own pieces
            int mobility = popcount(q_moves);
            // +3cp per legal queen move (max ~27 moves)
            classical_score += mobility * 3 * color_sign;
            if (tl_breakdown) tl_breakdown->mobility += mobility * 3 * color_sign;
        }
        
        // ============================================================
        if (b.has_pixies()) {
        //  PHASE 4: FISSION REACTOR CAPTURE COUNTDOWN (Full Range)
        //  Reward the Reactor for EVERY capture, not just 3+.
        //  This incentivizes the engine to actively feed the Reactor.
        // ============================================================
        U64 fission_bb = b.pieces[c][FISSION_REACTOR];
        while (fission_bb) {
            int fsq = pop_lsb(fission_bb);
            int captures = b.ability_tracker[fsq].fission_captures;
            
            // Escalating bonus for EVERY capture (not just 3+)
            if (captures >= 1) {
                // Capture 1: +80, Capture 2: +160, Capture 3: +600, Capture 4: +800
                int countdown_bonus = 0;
                if (captures == 1) countdown_bonus = 80;
                else if (captures == 2) countdown_bonus = 160;
                else countdown_bonus = captures * 200; // 3+ = massive escalation
                
                classical_score += countdown_bonus * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += countdown_bonus * color_sign;
            }
            
            // Proximity bonus: if enemy King is within 3 squares AND captures >= 3, nuclear strike imminent!
            if (captures >= 3) {
                U64 enemy_king = b.pieces[them][KING];
                if (enemy_king) {
                    int ksq = get_lsb(enemy_king);
                    int fr = fsq / 8, fc = fsq % 8;
                    int kr = ksq / 8, kc = ksq % 8;
                    int dist_r = fr - kr; if (dist_r < 0) dist_r = -dist_r;
                    int dist_c = fc - kc; if (dist_c < 0) dist_c = -dist_c;
                    int dist = dist_r > dist_c ? dist_r : dist_c;
                    if (dist <= 3) {
                        classical_score += 400 * color_sign;
                        if (tl_breakdown) tl_breakdown->king_safety += 400 * color_sign;
                    }
                }
            }
        }
        
        // ============================================================
        //  PHASE 5: PARALYSIS / FREEZE VALUE (Fix 5)
        //  Bonus for our Basilisks/Icicles paralyzing enemy pieces.
        // ============================================================
        U64 occ_all = b.occupancies[BOTH];
        
        // Basilisk: paralyzes all enemies in diagonal line of sight
        // Raised from +30 to +50 per paralyzed piece to properly reward this devastating ability
        U64 our_basilisks = b.pieces[c][BASILISK];
        while (our_basilisks) {
            int bsq = pop_lsb(our_basilisks);
            U64 diag_vision = get_sliding_attacks(bsq, occ_all, true, false);
            U64 paralyzed_enemies = diag_vision & b.occupancies[them];
            int num_paralyzed = popcount(paralyzed_enemies);
            classical_score += num_paralyzed * 50 * color_sign;
            if (tl_breakdown) tl_breakdown->threats += num_paralyzed * 50 * color_sign;
        }
        
        // Icicle: freezes all adjacent enemies
        U64 our_icicles = b.pieces[c][ICICLE];
        while (our_icicles) {
            int isq = pop_lsb(our_icicles);
            U64 adj_squares = KING_ATTACKS[isq];
            U64 frozen_enemies = adj_squares & b.occupancies[them];
            while (frozen_enemies) {
                int fsq = pop_lsb(frozen_enemies);
                int pt = b.get_piece_on_square(fsq);
                if (pt != PIECE_TYPE_NONE && pt != KING) {
                    int freeze_bonus = PIECE_VALUES[pt] / 4;
                    classical_score += freeze_bonus * color_sign;
                    if (tl_breakdown) tl_breakdown->threats += freeze_bonus * color_sign;
                }
            }
        }
        
        // ============================================================
        //  PHASE 6: PILGRIM DISTANCE TRACKING (Fix 6)
        //  Continuous scaling bonus when Pilgrim is accumulating distance to resurrect a dead piece.
        // ============================================================
        U64 pilgrims = b.pieces[c][PILGRIM];
        while (pilgrims) {
            int psq = pop_lsb(pilgrims);
            if (!b.ability_tracker[psq].ability_used) {
                int dist = b.ability_tracker[psq].pilgrim_dist;
                bool has_dead_tier1 = b.dead_pieces_count[c][QUEEN] > 0 || 
                                      b.dead_pieces_count[c][MARAUDER] > 0 || 
                                      b.dead_pieces_count[c][BLADERUNNER] > 0;
                bool has_dead_tier2 = b.dead_pieces_count[c][ROOK] > 0 || 
                                      b.dead_pieces_count[c][PHASE_ROOK] > 0 || 
                                      b.dead_pieces_count[c][SUMOROOK] > 0 || 
                                      b.dead_pieces_count[c][BASILISK] > 0 || 
                                      b.dead_pieces_count[c][ICICLE] > 0;
                bool has_dead_tier3 = b.dead_pieces_count[c][BISHOP] > 0 || 
                                      b.dead_pieces_count[c][KNIGHT] > 0 ||
                                      b.dead_pieces_count[c][BOUNCER] > 0 ||
                                      b.dead_pieces_count[c][ARISTOCRAT] > 0 ||
                                      b.dead_pieces_count[c][DJINN] > 0 ||
                                      b.dead_pieces_count[c][ELECTROKNIGHT] > 0 ||
                                      b.dead_pieces_count[c][BANKER] > 0 ||
                                      b.dead_pieces_count[c][CAMEL] > 0 ||
                                      b.dead_pieces_count[c][KNIGHTMARE] > 0 ||
                                      b.dead_pieces_count[c][FISH_KNIGHT] > 0 ||
                                      b.dead_pieces_count[c][DANCER] > 0 ||
                                      b.dead_pieces_count[c][GUNSLINGER] > 0 ||
                                      b.dead_pieces_count[c][CARDINAL] > 0 ||
                                      b.dead_pieces_count[c][HORDE_MOTHER] > 0;
                bool has_dead_pawn = b.dead_pieces_count[c][PAWN] > 0 || 
                                     b.dead_pieces_count[c][GOLDEN_PAWN] > 0 ||
                                     b.dead_pieces_count[c][IRONPAWN] > 0 ||
                                     b.dead_pieces_count[c][EPEE_PAWN] > 0 ||
                                     b.dead_pieces_count[c][PAWN_KNIFE] > 0 ||
                                     b.dead_pieces_count[c][HERO_PAWN] > 0 ||
                                     b.dead_pieces_count[c][SHRIKE] > 0 ||
                                     b.dead_pieces_count[c][WARP_JUMPER] > 0 ||
                                     b.dead_pieces_count[c][WAR_AUTOMATON] > 0;
                
                int multiplier = 2; // Default baseline multiplier
                if (has_dead_tier1) multiplier = 18;
                else if (has_dead_tier2) multiplier = 12;
                else if (has_dead_tier3) multiplier = 8;
                else if (has_dead_pawn) multiplier = 3;
                
                classical_score += dist * multiplier * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += dist * multiplier * color_sign;
            }
        }
        
        // ============================================================
        //  PHASE 6B: ENEMY PILGRIM TRACKING
        //  Penalize opponent's Pilgrim distance and reward threatening/attacking
        //  enemy Pilgrims that are close to resurrection.
        // ============================================================
        U64 enemy_pilgrims = b.pieces[them][PILGRIM];
        while (enemy_pilgrims) {
            int epsq = pop_lsb(enemy_pilgrims);
            if (!b.ability_tracker[epsq].ability_used) {
                int edist = b.ability_tracker[epsq].pilgrim_dist;
                bool enemy_dead_tier1 = b.dead_pieces_count[them][QUEEN] > 0 || 
                                        b.dead_pieces_count[them][MARAUDER] > 0 || 
                                        b.dead_pieces_count[them][BLADERUNNER] > 0;
                bool enemy_dead_tier2 = b.dead_pieces_count[them][ROOK] > 0 || 
                                        b.dead_pieces_count[them][PHASE_ROOK] > 0 || 
                                        b.dead_pieces_count[them][SUMOROOK] > 0 || 
                                        b.dead_pieces_count[them][BASILISK] > 0 || 
                                        b.dead_pieces_count[them][ICICLE] > 0;
                bool enemy_dead_tier3 = b.dead_pieces_count[them][BISHOP] > 0 || 
                                        b.dead_pieces_count[them][KNIGHT] > 0 ||
                                        b.dead_pieces_count[them][BOUNCER] > 0 ||
                                        b.dead_pieces_count[them][ARISTOCRAT] > 0 ||
                                        b.dead_pieces_count[them][DJINN] > 0 ||
                                        b.dead_pieces_count[them][ELECTROKNIGHT] > 0 ||
                                        b.dead_pieces_count[them][BANKER] > 0 ||
                                        b.dead_pieces_count[them][CAMEL] > 0 ||
                                        b.dead_pieces_count[them][KNIGHTMARE] > 0 ||
                                        b.dead_pieces_count[them][FISH_KNIGHT] > 0 ||
                                        b.dead_pieces_count[them][DANCER] > 0 ||
                                        b.dead_pieces_count[them][GUNSLINGER] > 0 ||
                                        b.dead_pieces_count[them][CARDINAL] > 0 ||
                                        b.dead_pieces_count[them][HORDE_MOTHER] > 0;
                bool enemy_dead_pawn = b.dead_pieces_count[them][PAWN] > 0 || 
                                       b.dead_pieces_count[them][GOLDEN_PAWN] > 0 ||
                                       b.dead_pieces_count[them][IRONPAWN] > 0 ||
                                       b.dead_pieces_count[them][EPEE_PAWN] > 0 ||
                                       b.dead_pieces_count[them][PAWN_KNIFE] > 0 ||
                                       b.dead_pieces_count[them][HERO_PAWN] > 0 ||
                                       b.dead_pieces_count[them][SHRIKE] > 0 ||
                                       b.dead_pieces_count[them][WARP_JUMPER] > 0 ||
                                       b.dead_pieces_count[them][WAR_AUTOMATON] > 0;
                
                int emultiplier = 1;
                if (enemy_dead_tier1) emultiplier = 8;
                else if (enemy_dead_tier2) emultiplier = 5;
                else if (enemy_dead_tier3) emultiplier = 3;
                else if (enemy_dead_pawn) emultiplier = 1;
                
                // Penalize enemy's distance (which is a relative penalty of edist * emultiplier * color_sign)
                classical_score -= edist * emultiplier * color_sign;
                if (tl_breakdown) tl_breakdown->threats -= edist * emultiplier * color_sign;
                
                // If enemy Pilgrim is close to resurrection, reward us for attacking it!
                if (edist >= 10 && b.is_square_attacked(epsq, (Color)c)) {
                    classical_score += 100 * color_sign; // Extra incentive to target it!;
                    if (tl_breakdown) tl_breakdown->threats += 100 * color_sign; // Extra incentive to target it!;
                }
            }
        }
        
        // ============================================================
        //  PHASE 7: HORDE INTEGRITY PENALTY (Fix 7)
        //  If ANY Hordeling or the Horde Mother is hanging, the ENTIRE swarm is at risk.
        // ============================================================
        U64 horde_mother = b.pieces[c][HORDE_MOTHER];
        if (horde_mother) {
            int num_hordelings = popcount(b.pieces[c][HORDELING]);
            bool chain_death_risk = false;
            
            // Check if the Horde Mother herself is under attack (chain death!)
            int msq = get_lsb(horde_mother);
            if (b.is_square_attacked(msq, them)) {
                chain_death_risk = true;
            }
            
            // Check if any Hordeling is under attack
            if (!chain_death_risk) {
                U64 hordelings = b.pieces[c][HORDELING];
                while (hordelings) {
                    int hsq = pop_lsb(hordelings);
                    if (b.is_square_attacked(hsq, them)) {
                        chain_death_risk = true;
                        break;
                    }
                }
            }
            
            if (chain_death_risk && num_hordelings > 0) {
                // Losing ANY hordeling or the Mother kills the Mother + ALL hordelings
                classical_score -= (350 + num_hordelings * 100) * color_sign;
                if (tl_breakdown) tl_breakdown->threats -= (350 + num_hordelings * 100) * color_sign;
            }
        }
        
        // ============================================================
        //  PHASE 8: HERO PAWN CHECK PROXIMITY (Fix 8)
        //  If a Hero Pawn can deliver check, it instantly becomes a Queen!
        // ============================================================
        U64 hero_pawns = b.pieces[c][HERO_PAWN];
        while (hero_pawns) {
            int hsq = pop_lsb(hero_pawns);
            int hr = hsq / 8, hc = hsq % 8;
            int dir = (c == WHITE) ? 1 : -1;
            
            // Check if pawn attack squares can reach enemy King
            U64 enemy_king = b.pieces[them][KING];
            if (enemy_king) {
                int ksq = get_lsb(enemy_king);
                int kr = ksq / 8, kc = ksq % 8;
                
                // Pawn attacks diagonally forward
                int attack_r = hr + dir;
                if (attack_r >= 0 && attack_r < 8) {
                    if ((hc - 1 >= 0 && attack_r == kr && hc - 1 == kc) ||
                        (hc + 1 < 8  && attack_r == kr && hc + 1 == kc)) {
                        // Hero Pawn can check the King = instant Queen promotion!
                        classical_score += 200 * color_sign;
                        if (tl_breakdown) tl_breakdown->king_safety += 200 * color_sign;
                    }
                }
                
                // Also bonus for being within 2 squares of King (close to check range)
                int dist_r = hr - kr; if (dist_r < 0) dist_r = -dist_r;
                int dist_c = hc - kc; if (dist_c < 0) dist_c = -dist_c;
                if (dist_r <= 2 && dist_c <= 2) {
                    classical_score += 50 * color_sign;
                    if (tl_breakdown) tl_breakdown->king_safety += 50 * color_sign;
                }
            }
        }
        
        // ============================================================
        //  PHASE 9: ELECTROKNIGHT CHARGE BONUS
        //  When fully charged, it can chain-lightning a nearby high-value piece on its next capture.
        // ============================================================
        U64 electroknights = b.pieces[c][ELECTROKNIGHT];
        while (electroknights) {
            int esq = pop_lsb(electroknights);
            int charges = b.ability_tracker[esq].electro_moves;
            if (charges >= 2) {
                // Charged and dangerous — bonus if near enemy clusters
                classical_score += charges * 40 * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += charges * 40 * color_sign;
                
                // Proximity bonus: if enemy King is within 3 squares, zap imminent!
                U64 enemy_king = b.pieces[them][KING];
                if (enemy_king) {
                    int ksq = get_lsb(enemy_king);
                    int er = esq / 8, ec = esq % 8;
                    int kr = ksq / 8, kc = ksq % 8;
                    int dist_r = er - kr; if (dist_r < 0) dist_r = -dist_r;
                    int dist_c = ec - kc; if (dist_c < 0) dist_c = -dist_c;
                    int dist = dist_r > dist_c ? dist_r : dist_c; // Chebyshev distance
                    if (dist <= 3) {
                        classical_score += 300 * color_sign; // Zap imminent!;
                        if (tl_breakdown) tl_breakdown->king_safety += 300 * color_sign; // Zap imminent!;
                    }
                }
            }
        }
        
        // ============================================================
        //  PHASE 10: BLADERUNNER STRATEGY (Max 1 Jump)
        //  Bonus for targeting high-value pieces and MASSIVE penalty if our King is in an enemy Bladerunner's path
        // ============================================================
        U64 bladerunners = b.pieces[c][BLADERUNNER];
        while (bladerunners) {
            int bsq = pop_lsb(bladerunners);
            int r = bsq / 8;
            int c_col = bsq % 8;
            int dirs[4][2] = {{-1,-1}, {-1,1}, {1,-1}, {1,1}};
            
            for (int i = 0; i < 4; i++) {
                int cr = r + dirs[i][0];
                int cc = c_col + dirs[i][1];
                int passed = 0;
                while (cr >= 0 && cr <= 7 && cc >= 0 && cc <= 7) {
                    int to_sq = cr * 8 + cc;
                    if (get_bit(b.occupancies[c], to_sq)) break; // Blocked by friendly
                    
                    if (get_bit(b.occupancies[them], to_sq)) {
                        if (passed >= 1) break; // Can only pass one piece!
                        passed++;
                        
                        // Offensive Threat: Reward for threatening high-value pieces
                        int pt = b.get_piece_on_square(to_sq);
                        if (pt == KING) {
                            classical_score += 500 * color_sign; // Huge bonus for threatening King;
                            if (tl_breakdown) tl_breakdown->threats += 500 * color_sign; // Huge bonus for threatening King;
                        } else if (pt == QUEEN || pt == FISSION_REACTOR || pt == MARAUDER) {
                            classical_score += 150 * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential += 150 * color_sign;
                        } else {
                            classical_score += 30 * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential += 30 * color_sign;
                        }
                    }
                    cr += dirs[i][0];
                    cc += dirs[i][1];
                }
            }
        }
        
        // Defensive King Protection
        U64 enemy_bladerunners = b.pieces[them][BLADERUNNER];
        while (enemy_bladerunners) {
            int bsq = pop_lsb(enemy_bladerunners);
            int r = bsq / 8;
            int c_col = bsq % 8;
            int dirs[4][2] = {{-1,-1}, {-1,1}, {1,-1}, {1,1}};
            
            for (int i = 0; i < 4; i++) {
                int cr = r + dirs[i][0];
                int cc = c_col + dirs[i][1];
                int passed = 0;
                while (cr >= 0 && cr <= 7 && cc >= 0 && cc <= 7) {
                    int to_sq = cr * 8 + cc;
                    if (get_bit(b.occupancies[them], to_sq)) break; // Blocked by enemy's friendly piece
                    
                    if (get_bit(b.occupancies[c], to_sq)) {
                        if (passed >= 1) break; // Can only pass one piece!
                        passed++;
                        
                        int pt = b.get_piece_on_square(to_sq);
                        if (pt == KING) {
                            // Our King is doomed next turn if we don't move it or block it!
                            classical_score -= 20000 * color_sign; // Massive penalty, effectively Checkmate evasion;
                            if (tl_breakdown) tl_breakdown->king_safety -= 20000 * color_sign; // Massive penalty, effectively Checkmate evasion;
                        }
                    }
                    cr += dirs[i][0];
                    cc += dirs[i][1];
                }
            }
        }
        
        // ============================================================
        //  PHASE 11: KNIGHTMARE LIMBO BONUS & TRAP DETECTION
        //  Dynamic Threat & Trapping Evaluation for Off-board Knightmares
        //  + Enemy Knightmare Defense + Behind-King Strategy
        // ============================================================
        if (b.num_knightmares_limbo[c] > 0) {
            // Restore Base Material Value!
            classical_score += b.num_knightmares_limbo[c] * PIECE_VALUES[KNIGHTMARE] * color_sign;
            if (tl_breakdown) {
                tl_breakdown->power_potential += b.num_knightmares_limbo[c] * PIECE_VALUES[KNIGHTMARE] * color_sign;
                tl_breakdown->km.material += b.num_knightmares_limbo[c] * PIECE_VALUES[KNIGHTMARE] * color_sign;
            }
            
            int km_dirs[8][2] = {{-2,-1}, {-2,1}, {-1,-2}, {-1,2}, {1,-2}, {1,2}, {2,-1}, {2,1}};
            U64 enemy_king_bb = b.pieces[them][KING];
            int eking_sq = enemy_king_bb ? get_lsb(enemy_king_bb) : -1;
            int ekr = (eking_sq >= 0) ? eking_sq / 8 : -1;
            int ekc = (eking_sq >= 0) ? eking_sq % 8 : -1;
            
            for (int i = 0; i < b.num_knightmares_limbo[c]; i++) {
                uint8_t encoded = b.knightmare_limbo_coords[c][i];
                int ob_r = (encoded >> 4) - 3;
                int ob_c = (encoded & 0xF) - 3;
                
                // Accumulator for all positional bonuses (will be capped)
                int km_positional_bonus = 0;
                
                int safe_landing_squares = 0;
                int advanced_safe_landings = 0;
                bool threatens_high_value = false;
                bool threatens_king = false;
                int best_capture_value = 0;
                
                for (int d = 0; d < 8; d++) {
                    int nr = ob_r + km_dirs[d][0];
                    int nc = ob_c + km_dirs[d][1];
                    if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
                        int to_sq = nr * 8 + nc;
                        if (tl_breakdown) tl_breakdown->km.state.legal_drop_count++;
                        
                        if (!b.is_square_attacked(to_sq, them)) {
                            safe_landing_squares++;
                            bool advanced = (c == WHITE) ? (nr >= 4) : (nr <= 3);
                            if (advanced) advanced_safe_landings++;
                        }
                        
                        // Can we capture a high-value piece?
                        if (get_bit(b.occupancies[them], to_sq)) {
                            if (tl_breakdown) tl_breakdown->km.state.capture_drop_count++;
                            if (get_bit(b.pieces[them][KING], to_sq)) {
                                threatens_king = true;
                                best_capture_value = std::max(best_capture_value, 20000);
                            }
                            if (get_bit(b.pieces[them][QUEEN], to_sq) ||
                                get_bit(b.pieces[them][FISSION_REACTOR], to_sq)) {
                                threatens_high_value = true;
                                best_capture_value = std::max(best_capture_value, 1050);
                            }
                            if (get_bit(b.pieces[them][BASILISK], to_sq) ||
                                get_bit(b.pieces[them][MARAUDER], to_sq)) {
                                threatens_high_value = true;
                                best_capture_value = std::max(best_capture_value, 600);
                            }
                            if (get_bit(b.pieces[them][PHASE_ROOK], to_sq) ||
                                get_bit(b.pieces[them][ROOK], to_sq)) {
                                threatens_high_value = true;
                                best_capture_value = std::max(best_capture_value, 500);
                            }
                        }
                    }
                }
                
                bool can_reach_board = (ob_r >= -2 && ob_r <= 9 && ob_c >= -2 && ob_c <= 9);
                
                if (safe_landing_squares == 0 && can_reach_board) {
                    if (tl_breakdown) tl_breakdown->km.state.trapped = true;
                    if (b.num_knightmares_limbo[them] > 0) {
                        km_positional_bonus -= 100;
                    } else {
                        km_positional_bonus -= 20;
                    }
                } else if (advanced_safe_landings == 0) {
                    km_positional_bonus -= 15;
                } else {
                    km_positional_bonus += (15 * advanced_safe_landings);
                }
                
                if (threatens_king) {
                    km_positional_bonus += 150;
                }
                
                if (threatens_high_value) {
                    km_positional_bonus += (best_capture_value / 4);
                }
                
                // --- LIMBO FORWARD TRAVERSAL GRADIENT ---
                int depth_bonus = 0;
                if (c == WHITE) {
                    if (ob_r < 0) {
                        depth_bonus = -350;
                    } else if (ob_r <= 3) {
                        depth_bonus = -250;
                    } else {
                        depth_bonus = (ob_r - 3) * 25;
                    }
                } else {
                    if (ob_r > 7) {
                        depth_bonus = -350;
                    } else if (ob_r >= 4) {
                        depth_bonus = -250;
                    } else {
                        depth_bonus = (4 - ob_r) * 25;
                    }
                }
                km_positional_bonus += depth_bonus;
                
                // --- BEHIND-KING STRATEGY ---
                if (eking_sq >= 0) {
                    bool behind_king = false;
                    int rank_depth = 0;
                    if (c == WHITE) {
                        behind_king = (ob_r > ekr);
                        rank_depth = ob_r - ekr;
                    } else {
                        behind_king = (ob_r < ekr);
                        rank_depth = ekr - ob_r;
                    }
                    if (behind_king && rank_depth <= 3) {
                        int file_dist = std::abs(ob_c - ekc);
                        if (file_dist <= 3) {
                            int base_bonus = 100 - (rank_depth - 1) * 15;
                            int file_penalty = file_dist * 10;
                            int ambush_bonus = std::max(base_bonus - file_penalty, 30);
                            km_positional_bonus += (int)(ambush_bonus * gamePhase);
                        }
                    }
                }
                
                // === CRITICAL: CAP the total positional bonus to prevent evaluation inflation ===
                // A Knightmare in Limbo should never be worth more than a Knight's extra positional value.
                if (km_positional_bonus > 300) km_positional_bonus = 300;
                // Penalties are uncapped (trapped Knightmares should still be heavily penalized)
                
                classical_score += km_positional_bonus * color_sign;
                if (tl_breakdown) {
                    tl_breakdown->power_potential += km_positional_bonus * color_sign;
                    tl_breakdown->km.deployment_readiness += km_positional_bonus * color_sign;
                }
            }
        }
        
        // --- ENEMY KNIGHTMARE DEFENSE ---
        // Penalize if our high-value pieces (Basilisk, Queen, Fission Reactor) are in 
        // enemy Knightmare's landing range from limbo
        if (b.num_knightmares_limbo[them] > 0) {
            int km_dirs[8][2] = {{-2,-1}, {-2,1}, {-1,-2}, {-1,2}, {1,-2}, {1,2}, {2,-1}, {2,1}};
            
            for (int ei = 0; ei < b.num_knightmares_limbo[them]; ei++) {
                uint8_t encoded = b.knightmare_limbo_coords[them][ei];
                int ob_r = (encoded >> 4) - 3;
                int ob_c = (encoded & 0xF) - 3;
                
                for (int d = 0; d < 8; d++) {
                    int nr = ob_r + km_dirs[d][0];
                    int nc = ob_c + km_dirs[d][1];
                    if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
                        int to_sq = nr * 8 + nc;
                        
                        // Check if our high-value pieces are exposed to this landing
                        // BASILISK MUST BE PRESERVED — never used as bait!
                        if (get_bit(b.pieces[c][BASILISK], to_sq)) {
                            // Basilisk is threatened by enemy Knightmare drop!
                            // ALWAYS penalize heavily because enemy Knightmare will gladly trade itself
                            classical_score -= 200 * color_sign; 
                            if (tl_breakdown) tl_breakdown->power_potential -= 200 * color_sign; 
                        }
                        if (get_bit(b.pieces[c][QUEEN], to_sq) || 
                            get_bit(b.pieces[c][FISSION_REACTOR], to_sq)) {
                            classical_score -= 300 * color_sign; // Queen/Reactor in drop zone!;
                            if (tl_breakdown) tl_breakdown->threats -= 300 * color_sign; // Queen/Reactor in drop zone!;
                        }
                        if (get_bit(b.pieces[c][KING], to_sq)) {
                            // King is in Knightmare drop range!
                            classical_score -= 150 * color_sign;
                            if (tl_breakdown) tl_breakdown->power_potential -= 150 * color_sign;
                        }
                    }
                }
            }
            // Limbo-to-Limbo Defense: Check if our Limbo Knightmares are exposed to enemy Limbo Knightmares
            for (int oi = 0; oi < b.num_knightmares_limbo[c]; oi++) {
                uint8_t our_encoded = b.knightmare_limbo_coords[c][oi];
                for (int ei = 0; ei < b.num_knightmares_limbo[them]; ei++) {
                    if (b.knightmare_limbo_coords[them][ei] == our_encoded) {
                        classical_score -= 300 * color_sign; // Our Limbo Knightmare is under attack in Limbo!
                        if (tl_breakdown) tl_breakdown->threats -= 300 * color_sign;
                    }
                }
            }
        }
        
        // ============================================================
        //  PHASE 12: GOLDEN PAWN ADVANCEMENT (Fix 8)
        //  Golden Pawn wins the game instantly upon reaching the final rank.
        // ============================================================
        U64 golden_pawns = b.pieces[c][GOLDEN_PAWN];
        while (golden_pawns) {
            int gsq = pop_lsb(golden_pawns);
            int rank = gsq / 8;
            int dist_to_prom = (c == WHITE) ? (7 - rank) : rank;
            
            if (dist_to_prom == 4) {
                classical_score += 100 * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += 100 * color_sign;
            } else if (dist_to_prom == 3) {
                classical_score += 250 * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += 250 * color_sign;
            } else if (dist_to_prom == 2) {
                classical_score += 500 * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += 500 * color_sign;
            } else if (dist_to_prom == 1) {
                classical_score += 1000 * color_sign;
                if (tl_breakdown) tl_breakdown->power_potential += 1000 * color_sign;
            }
        }
        
        // ============================================================
        //  PHASE 13: SHRIKE TRAP BONUS
        //  Bonus for keeping an unmoved Shrike in its starting position to act as an area-denial trap.
        // ============================================================
        U64 shrikes = b.pieces[c][SHRIKE];
        while (shrikes) {
            int s_sq = pop_lsb(shrikes);
            int r = s_sq / 8;
            if ((c == WHITE && r == 1) || (c == BLACK && r == 6)) {
                classical_score += 40 * color_sign; // Patience bonus: Keep the Shrike loaded!;
                if (tl_breakdown) tl_breakdown->power_potential += 40 * color_sign; // Patience bonus: Keep the Shrike loaded!;
            }
        }

        // ============================================================
        //  PHASE 14: DEFENSIVE AWARENESS
        //  Penalty for own high-value pieces in enemy Bladerunner diagonals
        //  and enemy Marauder range. Bonus for own Bouncer threatening enemies.
        // ============================================================
        
        // Bladerunner threat logic was moved to Phase 10 and rewritten for max 1 jump rule.
        
        // Enemy Marauder expanding range threat
        U64 enemy_marauders = b.pieces[them][MARAUDER];
        while (enemy_marauders) {
            int msq = pop_lsb(enemy_marauders);
            int kills = b.ability_tracker[msq].marauder_kills;
            int max_range = 1 + kills * 2;
            if (max_range >= 3) {
                // Dangerous marauder — penalty for our King proximity
                U64 our_king = b.pieces[c][KING];
                if (our_king) {
                    int ksq = get_lsb(our_king);
                    int mr = msq / 8, mc = msq % 8;
                    int kr = ksq / 8, kc = ksq % 8;
                    int dist_r = mr - kr; if (dist_r < 0) dist_r = -dist_r;
                    int dist_c = mc - kc; if (dist_c < 0) dist_c = -dist_c;
                    int dist = dist_r > dist_c ? dist_r : dist_c;
                    if (dist <= max_range) {
                        classical_score -= 200 * color_sign; // King in marauder range!;
                        if (tl_breakdown) tl_breakdown->power_potential -= 200 * color_sign; // King in marauder range!;
                    }
                }
            }
        }
        
        // Enemy Fission Reactor blast radius threat
        U64 enemy_reactors = b.pieces[them][FISSION_REACTOR];
        while (enemy_reactors) {
            int fsq = pop_lsb(enemy_reactors);
            U64 our_king = b.pieces[c][KING];
            if (our_king) {
                int ksq = get_lsb(our_king);
                int dist_r = std::abs((fsq / 8) - (ksq / 8));
                int dist_c = std::abs((fsq % 8) - (ksq % 8));
                if (std::max(dist_r, dist_c) <= 2) {
                    classical_score -= 150 * color_sign; // King in Reactor blast zone!;
                    if (tl_breakdown) tl_breakdown->king_safety -= 150 * color_sign; // King in Reactor blast zone!;
                }
            }
        }
        
        // Enemy Basilisk paralysis diagonal threat
        U64 enemy_basilisks = b.pieces[them][BASILISK];
        while (enemy_basilisks) {
            int bsq = pop_lsb(enemy_basilisks);
            U64 our_king = b.pieces[c][KING];
            if (our_king) {
                int ksq = get_lsb(our_king);
                if (std::abs((bsq / 8) - (ksq / 8)) == std::abs((bsq % 8) - (ksq % 8))) {
                    classical_score -= 150 * color_sign; // King paralyzed by Basilisk!;
                    if (tl_breakdown) tl_breakdown->power_potential -= 150 * color_sign; // King paralyzed by Basilisk!;
                }
            }
        }
        
        // Enemy Icicle freeze radius threat
        U64 enemy_icicles = b.pieces[them][ICICLE];
        while (enemy_icicles) {
            int isq = pop_lsb(enemy_icicles);
            U64 our_king = b.pieces[c][KING];
            if (our_king) {
                int ksq = get_lsb(our_king);
                int dist_r = std::abs((isq / 8) - (ksq / 8));
                int dist_c = std::abs((isq % 8) - (ksq % 8));
                if (std::max(dist_r, dist_c) <= 2) {
                    classical_score -= 100 * color_sign; // King in Icicle freeze zone!;
                    if (tl_breakdown) tl_breakdown->king_safety -= 100 * color_sign; // King in Icicle freeze zone!;
                }
            }
        }
        
        } // End of if (b.has_pixies()) for Phase 4 to 14

        // ============================================================
        //  PHASE 8: MATING NET / MOP-UP HEURISTICS (Endgame Optimization)
        //  Encourages driving the enemy King to the edges/corners, and bringing
        //  our King close to trap them only after analyzing remaining enemy threat/danger.
        // ============================================================
        int enemy_pieces_count = 0;
        for (int pt = 0; pt < PIECE_TYPE_COUNT; pt++) {
            enemy_pieces_count += popcount(b.pieces[them][pt]);
        }
        
        if (enemy_pieces_count <= 8) {
            U64 our_king_bb = b.pieces[c][KING];
            U64 enemy_king_bb = b.pieces[them][KING];
            
            if (our_king_bb && enemy_king_bb) {
                int our_king_sq = get_lsb(our_king_bb);
                int enemy_king_sq = get_lsb(enemy_king_bb);
                
                int ek_r = enemy_king_sq / 8;
                int ek_c = enemy_king_sq % 8;
                int ok_r = our_king_sq / 8;
                int ok_c = our_king_sq % 8;
                
                // 1. Push enemy king to the corners/edges (always safe and encouraged)
                int dist_to_center_r = std::max(3 - ek_r, ek_r - 4);
                int dist_to_center_c = std::max(3 - ek_c, ek_c - 4);
                int corner_dist = dist_to_center_r + dist_to_center_c; // 0 (center) to 6 (corners)
                
                // Only reward mop-up if we have a material advantage
                int our_material = 0;
                int enemy_material = 0;
                for (int pt = 0; pt < PIECE_TYPE_COUNT; pt++) {
                    our_material += popcount(b.pieces[c][pt]) * PIECE_VALUES[pt];
                    enemy_material += popcount(b.pieces[them][pt]) * PIECE_VALUES[pt];
                }
                
                if (our_material > enemy_material + 200) {
                    // Always reward cornering the enemy King
                    classical_score += corner_dist * 20 * color_sign;
                    if (tl_breakdown) tl_breakdown->king_safety += corner_dist * 20 * color_sign;
                    
                    // Analyze danger of left enemy pieces before bringing our King closer
                    bool enemy_has_queen = b.pieces[them][QUEEN] > 0 || b.pieces[them][FISSION_REACTOR] > 0 || b.pieces[them][MARAUDER] > 0;
                    bool enemy_has_rook = b.pieces[them][ROOK] > 0 || b.pieces[them][PHASE_ROOK] > 0 || b.pieces[them][SUMOROOK] > 0;
                    bool enemy_has_lethal_pixies = b.pieces[them][BASILISK] > 0 || b.pieces[them][ELECTROKNIGHT] > 0 || b.pieces[them][SHRIKE] > 0 || b.pieces[them][KNIGHTMARE] > 0;
                    
                    // Dangerous if they have a Queen/Reactor/Marauder, or a Rook/Lethal Pixie with other pieces
                    bool king_danger = enemy_has_queen || ((enemy_has_rook || enemy_has_lethal_pixies) && enemy_pieces_count > 3);
                    
                    if (!king_danger) {
                        int king_dist = std::abs(ek_r - ok_r) + std::abs(ek_c - ok_c); // 1 to 14
                        classical_score += (14 - king_dist) * 15 * color_sign;
                        if (tl_breakdown) tl_breakdown->king_safety += (14 - king_dist) * 15 * color_sign;
                    } else {
                        // Danger! Keep our king away from their remaining pieces
                        int king_dist = std::max(std::abs(ok_r - ek_r), std::abs(ok_c - ek_c));
                        classical_score -= (7 - king_dist) * 20 * color_sign;
                        if (tl_breakdown) tl_breakdown->king_safety -= (7 - king_dist) * 20 * color_sign;
                    }
                }
            }
        }
        
        // Own Bouncer threatening enemies via bounce-rays
        U64 our_bouncers = b.pieces[c][BOUNCER];
        while (our_bouncers) {
            int bsq = pop_lsb(our_bouncers);
            int br = bsq / 8, bc = bsq % 8;
            int dirs[4][2] = {{-1,-1}, {-1,1}, {1,-1}, {1,1}};
            for (int d = 0; d < 4; d++) {
                int cr = br, cc = bc;
                int dr = dirs[d][0], dc = dirs[d][1];
                bool bounced = false;
                while (true) {
                    int nr = cr + dr, nc = cc + dc;
                    if (nr < 0 || nr > 7) {
                        if (bounced) break;
                        dr = -dr; bounced = true; nr = cr + dr;
                    }
                    if (nc < 0 || nc > 7) {
                        if (bounced) break;
                        dc = -dc; bounced = true; nc = cc + dc;
                    }
                    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) break;
                    int nsq = nr * 8 + nc;
                    if (get_bit(b.occupancies[c], nsq)) break;
                    if (get_bit(b.occupancies[them], nsq)) {
                        int t_type = b.get_piece_on_square(nsq);
                        if (t_type != PIECE_TYPE_NONE && PIECE_VALUES[t_type] >= 300) {
                            classical_score += 25 * color_sign; // Bouncer threatens valuable enemy;
                            if (tl_breakdown) tl_breakdown->power_potential += 25 * color_sign; // Bouncer threatens valuable enemy;
                        }
                        break;
                    }
                    cr = nr; cc = nc;
                }
            }
        }

        // ============================================================
        if (b.has_pixies()) {
        //  PHASE 15: PAWN POWER PIECES UTILIZATION
        // ============================================================
        // PAWN_KNIFE: Threat bonus if an enemy is in its strike zone (dx=±2, dy=2 forward)
        U64 pawn_knives = b.pieces[c][PAWN_KNIFE];
        while (pawn_knives) {
            int sq = pop_lsb(pawn_knives);
            int r = sq / 8, fc = sq % 8;
            int dir = (c == WHITE) ? 1 : -1; // FIXED: White attacks higher ranks (+1), Black attacks lower ranks (-1)
            int targets_found = 0;
            int dc_offsets[2] = {-2, 2};
            for (int i = 0; i < 2; i++) {
                int er = r + (dir * 2);
                int ec = fc + dc_offsets[i];
                if (er >= 0 && er <= 7 && ec >= 0 && ec <= 7) {
                    int esq = er * 8 + ec;
                    if (get_bit(b.occupancies[them], esq)) {
                        int e_type = b.get_piece_on_square(esq);
                        if (e_type != IRONPAWN) targets_found++;
                    }
                }
            }
            if (targets_found > 0) classical_score += targets_found * 75 * color_sign;
            if (targets_found > 0) if (tl_breakdown) tl_breakdown->threats += targets_found * 75 * color_sign;
        }

        // HERO_PAWN: Scaling bonus the closer it gets to enemy King
        U64 hero_pawns_prox = b.pieces[c][HERO_PAWN];
        while (hero_pawns_prox) {
            int sq = pop_lsb(hero_pawns_prox);
            int r = sq / 8, fc = sq % 8;
            U64 enemy_king = b.pieces[them][KING];
            if (enemy_king) {
                int ksq = get_lsb(enemy_king);
                int kr = ksq / 8, kc = ksq % 8;
                int dist_r = std::abs(r - kr);
                int dist_c = std::abs(fc - kc);
                int dist = std::max(dist_r, dist_c);
                int proximity_bonus = std::max(0, 6 - dist);
                classical_score += proximity_bonus * 40 * color_sign;
                if (tl_breakdown) tl_breakdown->king_safety += proximity_bonus * 40 * color_sign;
            }
        }

        // WARP_JUMPER: Heavy progression bonus on A/H files
        U64 warp_jumpers = b.pieces[c][WARP_JUMPER];
        while (warp_jumpers) {
            int sq = pop_lsb(warp_jumpers);
            int r = sq / 8, fc = sq % 8;
            int advancement = (c == WHITE) ? r : (7 - r); // FIXED: Score should increase as pawn moves forward
            if (fc == 0 || fc == 7) {
                classical_score += advancement * 40 * color_sign; // Fast track to promotion;
                if (tl_breakdown) tl_breakdown->king_safety += advancement * 40 * color_sign; // Fast track to promotion;
            } else {
                classical_score += advancement * 10 * color_sign;
                if (tl_breakdown) tl_breakdown->king_safety += advancement * 10 * color_sign;
            }
        }

        // WAR_AUTOMATON: Bonus if safely waiting behind own pieces
        U64 war_automatons = b.pieces[c][WAR_AUTOMATON];
        while (war_automatons) {
            int sq = pop_lsb(war_automatons);
            int r = sq / 8, fc = sq % 8;
            int front_row = (c == WHITE) ? r + 1 : r - 1; // FIXED: White moves +1, Black moves -1
            if (front_row >= 0 && front_row <= 7) {
                int front_sq = front_row * 8 + fc;
                if (get_bit(b.occupancies[c], front_sq)) {
                    classical_score += 60 * color_sign; // Shielded;
                    if (tl_breakdown) tl_breakdown->king_safety += 60 * color_sign; // Shielded;
                }
            }
        }

        // EPEE_PAWN: Bonus based on how many enemy pawns are left (early/midgame presence)
        U64 epee_pawns = b.pieces[c][EPEE_PAWN];
        while (epee_pawns) {
            int sq = pop_lsb(epee_pawns);
            int enemy_pawns = popcount(b.pieces[them][PAWN]);
            classical_score += enemy_pawns * 10 * color_sign;
            if (tl_breakdown) tl_breakdown->king_safety += enemy_pawns * 10 * color_sign;
        }

        // ============================================================
        //  PHASE 16: BASILISK PARALYSIS THREATS
        // ============================================================
        U64 phase16_our_basilisks = b.pieces[c][BASILISK];
        U64 phase16_their_basilisks = b.pieces[them][BASILISK];
        
        if (phase16_our_basilisks) {
            U64 enemy_hv_targets = b.pieces[them][KING] | b.pieces[them][QUEEN] | b.pieces[them][FISSION_REACTOR];
            while (enemy_hv_targets) {
                int target_sq = pop_lsb(enemy_hv_targets);
                U64 temp_ob = phase16_our_basilisks;
                bool is_paralyzed = false;
                while (temp_ob) {
                    int b_sq = pop_lsb(temp_ob);
                    U64 attacks = get_sliding_attacks(b_sq, b.occupancies[BOTH], true, false);
                    if (get_bit(attacks, target_sq)) {
                        is_paralyzed = true;
                        break;
                    }
                }
                
                if (is_paralyzed) {
                    int pt = b.get_piece_on_square(target_sq);
                    if (pt == KING) {
                        classical_score += 400 * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += 400 * color_sign;
                        if (b.is_square_attacked(target_sq, (Color)c)) {
                            classical_score += 600 * color_sign; // Near-checkmate threat
                            if (tl_breakdown) tl_breakdown->power_potential += 600 * color_sign;
                        }
                    } else {
                        // Paralyzing an enemy piece is a temporary advantage, not a permanent trophy.
                        // Severely nerf the static bonus to prevent the bot from sacrificing pieces for cheap traps.
                        int freeze_bonus = std::min(PIECE_VALUES[pt] / 10, 80);
                        if (PIECE_VALUES[pt] >= 1400) freeze_bonus = 250;
                        classical_score += freeze_bonus * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += freeze_bonus * color_sign;
                        if (b.is_square_attacked(target_sq, (Color)c)) {
                            Board::AttackerInfo lowest = b.get_smallest_attacker(target_sq, (Color)c);
                            int attack_bonus = 0;
                            if (lowest.piece_type != PIECE_TYPE_NONE) {
                                if (PIECE_VALUES[lowest.piece_type] >= 500) {
                                    // MASSIVE PENALTY: Do not hover our High-Value pieces around a paralyzed enemy.
                                    attack_bonus = -1000;
                                } else {
                                    attack_bonus = 150;
                                }
                            }
                            classical_score += attack_bonus * color_sign; 
                            if (tl_breakdown) tl_breakdown->power_potential += attack_bonus * color_sign;
                        }
                    }
                }
            }
        }
        
        if (phase16_their_basilisks) {
            U64 our_hv_targets = b.pieces[c][KING] | b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR];
            while (our_hv_targets) {
                int target_sq = pop_lsb(our_hv_targets);
                U64 temp_tb = phase16_their_basilisks;
                bool is_paralyzed = false;
                while (temp_tb) {
                    int b_sq = pop_lsb(temp_tb);
                    U64 attacks = get_sliding_attacks(b_sq, b.occupancies[BOTH], true, false);
                    if (get_bit(attacks, target_sq)) {
                        is_paralyzed = true;
                        break;
                    }
                }
                
                if (is_paralyzed) {
                    int pt = b.get_piece_on_square(target_sq);
                    if (pt == KING) {
                        classical_score -= 800 * color_sign;
                        if (tl_breakdown) tl_breakdown->king_safety -= 800 * color_sign;
                        if (b.is_square_attacked(target_sq, (Color)them)) {
                            classical_score -= 2000 * color_sign;
                            if (tl_breakdown) tl_breakdown->threats -= 2000 * color_sign;
                        }
                    } else {
                        // Mirror the capped bonus for symmetry
                        int freeze_penalty = std::min(PIECE_VALUES[pt] / 10, 80);
                        if (PIECE_VALUES[pt] >= 1400) freeze_penalty = 250;
                        classical_score -= freeze_penalty * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential -= freeze_penalty * color_sign;
                        if (b.is_square_attacked(target_sq, (Color)them)) {
                            Board::AttackerInfo lowest = b.get_smallest_attacker(target_sq, (Color)them);
                            int attack_penalty = 0;
                            if (lowest.piece_type != PIECE_TYPE_NONE) {
                                if (PIECE_VALUES[lowest.piece_type] >= 500) {
                                    attack_penalty = -1000;
                                } else {
                                    attack_penalty = 150;
                                }
                            }
                            classical_score -= attack_penalty * color_sign; 
                            if (tl_breakdown) tl_breakdown->threats -= attack_penalty * color_sign;
                        }
                    }
                }
            }
        }
        
        // ============================================================
        //  PHASE 4B: UTILITY PIECE DEPLOYMENT BALANCER
        // ============================================================
        int deployed_utility = 0;
        int deployed_attackers = 0;
        
        // Count deployed pieces (advanced beyond back ranks, generally ranks 3-6)
        U64 middle_ranks = 0x00FFFFFFFFFFFF00ULL;
        
        // Attackers: Knights, Rooks, Bishops, Phase Rook, SumoRook, Bladerunner
        U64 attackers = b.pieces[c][KNIGHT] | b.pieces[c][ROOK] | b.pieces[c][BISHOP] |
                        b.pieces[c][PHASE_ROOK] | b.pieces[c][SUMOROOK] | b.pieces[c][BLADERUNNER] |
                        b.pieces[c][MARAUDER];
        deployed_attackers = popcount(attackers & middle_ranks);
        
        // Utilities: Bankers, Dancers, Anti-Violence, Basilisk, Aristocrat, Pilgrim
        U64 utilities = b.pieces[c][BANKER] | b.pieces[c][DANCER] | b.pieces[c][ANTI_VIOLENCE] |
                        b.pieces[c][BASILISK] | b.pieces[c][ARISTOCRAT] | b.pieces[c][PILGRIM];
        deployed_utility = popcount(utilities & middle_ranks);
        
        // If we have too many utility pieces pushed forward and not enough attackers supporting them
        if (deployed_utility >= 2 && deployed_attackers < 2) {
            classical_score -= 60 * color_sign; // Penalize excessive utility shuffling;
            if (tl_breakdown) tl_breakdown->threats -= 60 * color_sign; // Penalize excessive utility shuffling;
        }

        } // End of if (b.has_pixies()) for Phase 15 to 16

        // ============================================================
        //  PHASE 12: KING SAFETY
        //  Evaluate the safety of our King based on:
        //  - Number of enemy attackers in the king zone
        //  - Pawn shield integrity
        //  - Open files near the king
        //  - Castling rights preservation
        // ============================================================
        
        // ---- CASTLING RIGHTS PRESERVATION BONUS ----
        if (gamePhase > 0.7f) {
            int cr_bonus = 0;
            if (c == WHITE) {
                if (b.castling_rights & 1) cr_bonus += 30; // Kingside available
                if (b.castling_rights & 2) cr_bonus += 20; // Queenside available
            } else {
                if (b.castling_rights & 4) cr_bonus += 30;
                if (b.castling_rights & 8) cr_bonus += 20;
            }
            classical_score += (int)(cr_bonus * gamePhase) * color_sign;
            if (tl_breakdown) tl_breakdown->power_potential += (int)(cr_bonus * gamePhase) * color_sign;
        }
        
        if (gamePhase > 0.3f) {
            U64 our_king = b.pieces[c][KING];
            if (our_king) {
                int ksq = get_lsb(our_king);
                U64 king_zone = KING_ATTACKS[ksq] | (1ULL << ksq);
                
                // Count enemy pieces attacking squares in our king zone
                int attacker_count = 0;
                int attacker_weight = 0;
                
                // Check enemy sliding pieces attacking king zone
                U64 enemy_rq = b.pieces[them][ROOK] | b.pieces[them][QUEEN] | 
                               b.pieces[them][FISSION_REACTOR] | b.pieces[them][PHASE_ROOK];
                U64 enemy_bq = b.pieces[them][BISHOP] | b.pieces[them][QUEEN] | 
                               b.pieces[them][FISSION_REACTOR] | b.pieces[them][ARISTOCRAT] |
                               b.pieces[them][MARAUDER];
                
                U64 zone_sq = king_zone;
                while (zone_sq) {
                    int sq = pop_lsb(zone_sq);
                    if (b.is_square_attacked(sq, (Color)them)) {
                        attacker_count++;
                    }
                }
                
                // Exponential king danger: more attackers = significantly worse
                // Forces the engine to prioritize defending the King zone when under heavy threat
                const int safety_table[] = {0, -20, -80, -200, -400, -700, -1000, -1500, -2000, -2500};
                int danger_index = attacker_count < 9 ? attacker_count : 8;
                classical_score += safety_table[danger_index] * color_sign;
                if (tl_breakdown) tl_breakdown->threats += safety_table[danger_index] * color_sign;
                
                // Pawn shield bonus: check the 3 pawns in front of the king
                int kr = ksq / 8;
                int kc = ksq % 8;
                int pawn_dir = (c == WHITE) ? 1 : -1;
                int shield_row = kr + pawn_dir;
                
                if (shield_row >= 0 && shield_row < 8) {
                    int shield_pawns = 0;
                    for (int dc = -1; dc <= 1; dc++) {
                        int sc = kc + dc;
                        if (sc >= 0 && sc < 8) {
                            int shield_sq = shield_row * 8 + sc;
                            // Check all pawn types
                            if (get_bit(b.pieces[c][PAWN], shield_sq)) shield_pawns++;
                            else if (get_bit(b.pieces[c][IRONPAWN], shield_sq)) shield_pawns += 2; // Ironpawns are extra solid
                            else {
                                for (int pt = GOLDEN_PAWN; pt <= WAR_AUTOMATON; pt++) {
                                    if (get_bit(b.pieces[c][pt], shield_sq)) { shield_pawns++; break; }
                                }
                            }
                        }
                    }
                    // 3 shield pawns = +45, 2 = +30, 1 = +15, 0 = 0 (penalty already from attackers)
                    classical_score += shield_pawns * 15 * color_sign;
                    if (tl_breakdown) tl_breakdown->threats += shield_pawns * 15 * color_sign;
                    
                    // ============================================================
                    //  PHASE 17: DYNAMIC CASTLING & CENTER OPENNESS
                    // ============================================================
                    // Dynamic safety: is the center open?
                    bool d_open = true, e_open = true;
                    U64 all_pawns = b.pieces[WHITE][PAWN] | b.pieces[BLACK][PAWN];
                    for (int pt = GOLDEN_PAWN; pt <= WAR_AUTOMATON; pt++) {
                        all_pawns |= (b.pieces[WHITE][pt] | b.pieces[BLACK][pt]);
                    }
                    for (int r = 0; r < 8; r++) {
                        if (get_bit(all_pawns, r * 8 + 3)) d_open = false; // D file
                        if (get_bit(all_pawns, r * 8 + 4)) e_open = false; // E file
                    }
                    
                    if (ksq == ((c == WHITE) ? E1 : E8)) {
                        // King is in the center
                        if (d_open || e_open) {
                            classical_score -= 50 * color_sign; // Penalty for staying in an open center!;
                            if (tl_breakdown) tl_breakdown->center_control -= 50 * color_sign; // Penalty for staying in an open center!;
                        } else {
                            classical_score += 20 * color_sign; // Small bonus for being safe in a closed center;
                            if (tl_breakdown) tl_breakdown->center_control += 20 * color_sign; // Small bonus for being safe in a closed center;
                        }
                    } else if (kc == 6 || kc == 2) { // G-file or C-file (castled)
                        // Castling bonus depends strictly on the pawn shield!
                        if (shield_pawns >= 2) {
                            classical_score += 60 * color_sign; // Excellent castled position with a strong shield;
                            if (tl_breakdown) tl_breakdown->center_control += 60 * color_sign; // Excellent castled position with a strong shield;
                        } else if (shield_pawns == 0) {
                            classical_score -= 80 * color_sign; // Ruined shield on castled side! Dangerous!;
                            if (tl_breakdown) tl_breakdown->center_control -= 80 * color_sign; // Ruined shield on castled side! Dangerous!;
                        }
                    }
                }
            }
        }

        // ============================================================
        if (b.has_pixies()) {
        //  PHASE 18: ADVANCED OPENING STRATEGIES (KNIGHTMARE, BOUNCER, MARAUDER)
        // ============================================================
        
        // 1. Knightmare Opening & Mid-Game Engagement
        // No move number gate — Knightmare is valuable throughout the game
        if (b.pieces[c][KNIGHTMARE]) {
            U64 knightmares = b.pieces[c][KNIGHTMARE];
            while (knightmares) {
                int sq = pop_lsb(knightmares);
                int r = sq / 8;
                int col = sq % 8;
                // Wing deployment bonus (scales down over time)
                if (col <= 2 || col >= 5) {
                    classical_score += (int)(80 * gamePhase) * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += (int)(80 * gamePhase) * color_sign;
                }
                
                // Unsupported Spite Check / Panic Check Penalty
                U64 eking = b.pieces[them][KING];
                if (eking) {
                    int kr = get_lsb(eking) / 8;
                    int kc = get_lsb(eking) % 8;
                    if (std::abs(r - kr) <= 2 && std::abs(col - kc) <= 2) {
                        if (!b.is_square_attacked(sq, (Color)c)) {
                            classical_score -= 25 * color_sign; // Small penalty to discourage repetitive spite checks
                        }
                    }
                }
                
                // Tapered Opening Development (Reward moving off start rank safely, tapers to 0 in middlegame)
                if (gamePhase >= 0.7f) {
                    bool off_start = (c == WHITE) ? (r >= 1) : (r <= 6);
                    if (off_start) {
                        classical_score += (int)(25 * gamePhase) * color_sign;
                        if (tl_breakdown) {
                            tl_breakdown->power_potential += (int)(25 * gamePhase) * color_sign;
                        }
                    }
                }
            }
        }
        // Persistent Limbo Knightmare: bonus throughout opening AND mid-game (not just move 1-6)
        if (b.num_knightmares_limbo[c] > 0 && gamePhase > 0.35f) {
            // Ambush platform bonus — always reward a Knightmare waiting in limbo
            classical_score += (int)(110 * gamePhase) * color_sign;
            if (tl_breakdown) {
                tl_breakdown->power_potential += (int)(110 * gamePhase) * color_sign;
                tl_breakdown->km.ambush_platform += (int)(110 * gamePhase) * color_sign;
            }
        }
        
        // 2. Anti-Knightmare Bouncer Strategy
        // Triggered if opponent has Knightmare (on board or in limbo) and we have Bouncer
        if ((b.pieces[them][KNIGHTMARE] || b.num_knightmares_limbo[them] > 0) && b.pieces[c][BOUNCER]) {
            if (c == WHITE && get_bit(b.pieces[c][BOUNCER], F1)) {
                classical_score += 100 * color_sign; // Prefer F1 setup;
                if (tl_breakdown) tl_breakdown->power_potential += 100 * color_sign; // Prefer F1 setup;
            } else if (c == BLACK && get_bit(b.pieces[c][BOUNCER], F8)) {
                classical_score += 100 * color_sign; // Prefer F8 setup;
                if (tl_breakdown) tl_breakdown->power_potential += 100 * color_sign; // Prefer F8 setup;
            }
        }
        
        // 2b. Offensive Bouncer + Queen Trap (Instant Checkmate Threat)
        // If opponent has not opened their d-pawn, setup Queen on f3/f6 and Bouncer on e2/e7
        if (gamePhase >= 0.8f && b.pieces[c][BOUNCER] && (b.pieces[c][QUEEN] || b.pieces[c][FISSION_REACTOR])) {
            bool opp_d_pawn_unmoved = false;
            if (c == WHITE && get_bit(b.occupancies[BLACK], D7)) opp_d_pawn_unmoved = true;
            if (c == BLACK && get_bit(b.occupancies[WHITE], D2)) opp_d_pawn_unmoved = true;
            
            if (opp_d_pawn_unmoved) {
                int trap_bonus = 150; // High enough to incentivize, but randomized inherently by Alpha-Beta sequencing
                if (c == WHITE) {
                    if (get_bit(b.pieces[c][BOUNCER], E2)) classical_score += trap_bonus * color_sign;
                    if (get_bit(b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR], F3)) classical_score += trap_bonus * color_sign;
                } else {
                    if (get_bit(b.pieces[c][BOUNCER], E7)) classical_score += trap_bonus * color_sign;
                    if (get_bit(b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR], F6)) classical_score += trap_bonus * color_sign;
                }
            }
        }
        
        // --- VANGUARD SYNERGY CHECK ---
        // Check if we have a deadly piece deep in enemy territory (Rank 6-7 for White, 0-1 for Black)
        // or a Knightmare deep in Limbo.
        bool vanguard_active = false;
        U64 enemy_half = (c == WHITE) ? 0xFFFFFFFF00000000ULL : 0x00000000FFFFFFFFULL;
        U64 vanguard_pieces = b.pieces[c][PHASE_ROOK] | b.pieces[c][SUMOROOK] | b.pieces[c][BLADERUNNER] | b.pieces[c][BASILISK] | b.pieces[c][QUEEN] | b.pieces[c][FISSION_REACTOR];
        if (vanguard_pieces & enemy_half) vanguard_active = true;
        
        for (int ob_idx = 0; ob_idx < b.num_knightmares_limbo[c]; ob_idx++) {
            int ob_r = (b.knightmare_limbo_coords[c][ob_idx] >> 4) - 3;
            if (c == WHITE && ob_r >= 4) vanguard_active = true;
            if (c == BLACK && ob_r <= 3) vanguard_active = true;
        }

        // 3. Marauder Tapered Development & Contextual Threat
        if (b.pieces[c][MARAUDER]) {
            U64 marauders = b.pieces[c][MARAUDER];
            while (marauders) {
                int sq = pop_lsb(marauders);
                int r = sq / 8;
                
                // Tapered Opening Development (Reward moving off start rank safely, tapers to 0 in middlegame)
                if (gamePhase >= 0.7f) {
                    bool off_start = (c == WHITE) ? (r >= 1) : (r <= 6);
                    if (off_start) {
                        int dev_bonus = (int)(60 * gamePhase);
                        if (vanguard_active) dev_bonus *= 2; // Vanguard Synergy! Double the urgency!
                        classical_score += dev_bonus * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += dev_bonus * color_sign;
                    }
                }
                
                // Hunting Instinct (Prey Proximity)
                // If the Marauder has 0 kills, it is hungry and slow. It needs to stalk weak prey.
                int fc = sq % 8;
                if (b.ability_tracker[sq].marauder_kills == 0) {
                    int closest_prey_dist = 99;
                    U64 prey = b.pieces[them][PAWN] | b.pieces[them][GOLDEN_PAWN] | b.pieces[them][IRONPAWN] | 
                               b.pieces[them][EPEE_PAWN] | b.pieces[them][PAWN_KNIFE] | b.pieces[them][HERO_PAWN] | 
                               b.pieces[them][SHRIKE] | b.pieces[them][WARP_JUMPER] | b.pieces[them][WAR_AUTOMATON] | 
                               b.pieces[them][HORDELING]; // Focus on hunting all weak pieces
                    while (prey) {
                        int p_sq = pop_lsb(prey);
                        int p_r = p_sq / 8;
                        int p_c = p_sq % 8;
                        int dist = std::max(abs(r - p_r), abs(fc - p_c)); // Chebyshev distance
                        if (dist < closest_prey_dist) closest_prey_dist = dist;
                    }
                    if (closest_prey_dist < 99) {
                        // Max bonus at dist 1 (140), scales down by 20 per square away.
                        // This guarantees a +20 point delta for every single step forward, even from distance 7.
                        int hunt_bonus = std::max(0, 160 - (closest_prey_dist * 20));
                        if (vanguard_active) hunt_bonus *= 2; // Vanguard Synergy! Double the pull!
                        classical_score += hunt_bonus * color_sign;
                        if (tl_breakdown) tl_breakdown->power_potential += hunt_bonus * color_sign;
                    }
                }
                
                // Contextual Threat Radius: Does its 1-step range hit central squares or enemy territory?
                int center_pressure = 0;
                int dirs[8][2] = {{-1,0},{1,0},{0,-1},{0,1},{-1,-1},{-1,1},{1,-1},{1,1}};
                for (int i = 0; i < 8; i++) {
                    int nr = r + dirs[i][0];
                    int nc = fc + dirs[i][1];
                    if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
                        // Reward attacking central squares
                        if (nr >= 3 && nr <= 4 && nc >= 3 && nc <= 4) center_pressure += 2;
                        else if (nr >= 2 && nr <= 5 && nc >= 2 && nc <= 5) center_pressure += 1;
                        
                        // Reward attacking enemy territory
                        bool in_enemy = (c == WHITE) ? (nr >= 4) : (nr <= 3);
                        if (in_enemy) center_pressure += 1;
                    }
                }
                classical_score += (center_pressure * 6) * color_sign;
                if (tl_breakdown) tl_breakdown->center_control += (center_pressure * 6) * color_sign;
                
                // Feeding Bonus: Exponential Tiered Strategy
                // First Blood is worth 400 points to justify sacrificing a Knight (300) or Bishop (330) to feed it!
                int kills = b.ability_tracker[sq].marauder_kills;
                if (kills > 0) {
                    int feed_bonus = 0;
                    if (kills == 1) feed_bonus = 400;
                    else if (kills == 2) feed_bonus = 600;
                    else feed_bonus = 750 + ((kills - 3) * 50); // Cap explosive scaling after 3 kills
                    
                    classical_score += feed_bonus * color_sign;
                    if (tl_breakdown) tl_breakdown->power_potential += feed_bonus * color_sign;
                }
            }
        } 
        } // End of if (b.has_pixies()) for Phase 18 Advanced
    }
    
    // ============================================================
    //  PHASE 18: HANGING PIECE PENALTY (Anti-Hallucination)
    //  Prevents placing Queens/Knightmares on undefended squares where they get captured for free
    // ============================================================
    for (int c = WHITE; c <= BLACK; c++) {
        int color_sign = (c == WHITE) ? 1 : -1;
        int them = (c == WHITE) ? BLACK : WHITE;
        
        // Exclude pawns from hanging piece penalty (they are meant to be traded)
        U64 all_pawns = b.pieces[c][PAWN];
        for (int p_pt = GOLDEN_PAWN; p_pt <= WAR_AUTOMATON; p_pt++) {
            all_pawns |= b.pieces[c][p_pt];
        }
        all_pawns |= b.pieces[c][HORDELING];
        
        U64 non_pawns = b.occupancies[c] ^ all_pawns;
        
        while (non_pawns) {
            int sq = pop_lsb(non_pawns);
            int pt = b.get_piece_on_square(sq); // Get actual piece type
            
            if (pt != PIECE_TYPE_NONE && pt != KING) {
                // If attacked by the enemy
                if (b.is_square_attacked(sq, (Color)them)) {
                    bool defended = b.is_square_attacked(sq, (Color)c);
                    int penalty = 0;
                    
                    if (!defended) {
                        // Hanging Piece Penalty! (Full piece value!)
                        penalty = PIECE_VALUES[pt];
                        
                        // Sumorook and Banker cannot capture to defend themselves. 
                        // If they are attacked and undefended, they are completely trapped and dead. Apply full penalty.
                        if (pt == SUMOROOK || pt == BANKER) {
                            penalty = PIECE_VALUES[pt];
                        }
                    } else {
                        // It IS defended. But is it a BAD trade?
                        // For example, our Fission Reactor (1100) attacked by an enemy Pawn (100).
                        Board::AttackerInfo lowest_attacker = b.get_smallest_attacker(sq, (Color)them);
                        if (lowest_attacker.piece_type != PIECE_TYPE_NONE) {
                            int attacker_val = PIECE_VALUES[lowest_attacker.piece_type];
                            int our_val = PIECE_VALUES[pt];
                            
                            if (attacker_val < our_val - 150) {
                                // We are forced to lose the exchange. Penalize the material difference!
                                penalty = our_val - attacker_val;
                            } else if (our_val >= 1400) {
                                // QUEEN ENGAGEMENT PENALTY
                                // If the enemy Queen (or higher) attacks our Queen, we must run!
                                // Even an equal trade is penalized to prevent illogical Queen sacrifices early on.
                                penalty = 400;
                            }
                        }
                    }
                    
                    if (penalty > 0) {
                        classical_score -= penalty * color_sign;
                        if (tl_breakdown) tl_breakdown->threats -= penalty * color_sign;
                    }
                }
            }
        }
    }
    
    // ============================================================
    //  PHASE 19: MINOR PIECE DEVELOPMENT PENALTY
    //  Forces the bot to use its full arsenal instead of relying on a few pieces.
    // ============================================================
    for (int c = WHITE; c <= BLACK; c++) {
        int color_sign = (c == WHITE) ? 1 : -1;
        
        // Minor pieces (Knights and Bishops)
        U64 minors = b.pieces[c][KNIGHT] | b.pieces[c][ELECTROKNIGHT] | b.pieces[c][BANKER] | 
                     b.pieces[c][KNIGHTMARE] | b.pieces[c][ANTI_VIOLENCE] | b.pieces[c][FISH_KNIGHT] |
                     b.pieces[c][BISHOP] | b.pieces[c][ARISTOCRAT] | b.pieces[c][BASILISK] |
                     b.pieces[c][BLADERUNNER] | b.pieces[c][BOUNCER] | b.pieces[c][PILGRIM] |
                     b.pieces[c][DANCER] | b.pieces[c][DJINN] | b.pieces[c][GUNSLINGER] |
                     b.pieces[c][CARDINAL] | b.pieces[c][ICICLE] | b.pieces[c][HORDE_MOTHER] |
                     b.pieces[c][MARAUDER];
                     
        U64 start_rank_mask = (c == WHITE) ? 0x00000000000000FFULL : 0xFF00000000000000ULL;
        U64 undeveloped = minors & start_rank_mask;
        
        // 30 centipawn penalty per undeveloped minor piece
        int penalty = popcount(undeveloped) * 30;
        if (penalty > 0) {
            classical_score -= penalty * color_sign;
            if (tl_breakdown) tl_breakdown->development -= penalty * color_sign;
        }
    }
    
    // ============================================================
    //  PHASE 20: SUMOROOK STATIC DANGER ZONE
    //  Heavily penalizes parking high-value pieces directly in front of an enemy SumoRook's push ray
    // ============================================================
    for (int c = WHITE; c <= BLACK; c++) {
        int color_sign = (c == WHITE) ? 1 : -1;
        int them = (c == WHITE) ? BLACK : WHITE;
        
        U64 enemy_sumorooks = b.pieces[them][SUMOROOK];
        while (enemy_sumorooks) {
            int sr_sq = pop_lsb(enemy_sumorooks);
            int sr_r = sr_sq / 8;
            int sr_c = sr_sq % 8;
            
            // The push ray is directly in front of the SumoRook (relative to its color)
            int push_dir = (them == WHITE) ? -1 : 1;
            int target_r = sr_r + push_dir;
            
            if (target_r >= 0 && target_r < 8) {
                int target_sq = target_r * 8 + sr_c;
                // Check if one of OUR high-value pieces is parked in the target square
                int pt = b.get_piece_on_square(target_sq);
                if (pt != PIECE_TYPE_NONE && (b.pieces[c][pt] & (1ULL << target_sq))) {
                    if (PIECE_VALUES[pt] > 400 || pt == KING) {
                        // It's a high value piece (or King). Let's check the square BEHIND it.
                        int falloff_r = target_r + push_dir;
                        bool danger = false;
                        
                        if (falloff_r < 0 || falloff_r >= 8) {
                            danger = true; // It will be pushed off the board!
                        } else {
                            int falloff_sq = falloff_r * 8 + sr_c;
                            int falloff_pt = b.get_piece_on_square(falloff_sq);
                            // If the square behind is empty, it will be pushed into an empty square (which might be attacked by something else, or just wastes tempo). 
                            // But worse, if the square behind has an enemy piece, it might be captured.
                            if (falloff_pt == PIECE_TYPE_NONE) {
                                danger = true; // Being pushed is generally catastrophic for board position
                            }
                        }
                        
                        if (danger) {
                            int penalty = (pt == KING) ? 10000 : 1500;
                            classical_score -= penalty * color_sign;
                            if (tl_breakdown) tl_breakdown->threats -= penalty * color_sign;
                        }
                    }
                }
            }
        }
    }
    
    // ============================================================
    //  PHASE 21: PILGRIM OPEN-AREA FARMING
    //  Incentivizes the bot to repeatedly move the Pilgrim to farm 20 distance when not under threat
    // ============================================================
    for (int c = WHITE; c <= BLACK; c++) {
        int color_sign = (c == WHITE) ? 1 : -1;
        U64 pilgrims = b.pieces[c][PILGRIM];
        
        while (pilgrims) {
            int sq = pop_lsb(pilgrims);
            int dist = b.ability_tracker[sq].pilgrim_dist;
            
            // Base reward for having accumulated distance (financial incentive to not waste it)
            int dist_bonus = dist * 20;
            classical_score += dist_bonus * color_sign;
            if (tl_breakdown) tl_breakdown->power_potential += dist_bonus * color_sign;
            
            // Farming Incentive: If the game is quiet (gamePhase > 0.3) and we are not in check
            if (gamePhase > 0.3f && !b.in_check((Color)c)) {
                // Reward centralization so the Pilgrim has maximum mobility to pace back and forth
                int r = sq / 8;
                int fc = sq % 8;
                int center_dist = std::max(abs(r - 3), abs(r - 4)) + std::max(abs(fc - 3), abs(fc - 4));
                int open_area_bonus = (10 - center_dist) * 15;
                classical_score += open_area_bonus * color_sign;
                if (tl_breakdown) tl_breakdown->mobility += open_area_bonus * color_sign;
            }
        }
    }

    // ============================================================
    //  PHASE 22: ENDGAME MOP-UP LOGIC (KING TRAPPING)
    //  Forces the bot to checkmate the enemy King rather than pushing pawns endlessly when completely winning
    // ============================================================
    for (int c = WHITE; c <= BLACK; c++) {
        int color_sign = (c == WHITE) ? 1 : -1;
        int them = (c == WHITE) ? BLACK : WHITE;
        
        // Count major priority pieces for both sides
        U64 our_majors = b.pieces[c][QUEEN] | b.pieces[c][ROOK] | b.pieces[c][FISSION_REACTOR] | b.pieces[c][MARAUDER] | b.pieces[c][BLADERUNNER];
        U64 their_majors = b.pieces[them][QUEEN] | b.pieces[them][ROOK] | b.pieces[them][FISSION_REACTOR] | b.pieces[them][MARAUDER] | b.pieces[them][BLADERUNNER];
        
        int our_count = popcount(our_majors);
        int their_count = popcount(their_majors);
        
        // Mop-Up Condition: We have >= 2 major pieces, they have 0, and we are in the endgame
        if (our_count >= 2 && their_count == 0 && gamePhase < 0.4f) {
            
            // 1. Penalize non-essential pawn pushes
            U64 pawns = b.pieces[c][PAWN] | b.pieces[c][GOLDEN_PAWN];
            while (pawns) {
                int p_sq = pop_lsb(pawns);
                int p_r = p_sq / 8;
                bool is_close_to_promo = (c == WHITE) ? (p_r <= 2) : (p_r >= 5);
                if (!is_close_to_promo) {
                    // Heavy penalty for wasting tempo pushing distant pawns
                    classical_score -= 500 * color_sign;
                }
            }
            
            // 2. Trapping the Enemy King
            U64 their_king = b.pieces[them][KING];
            U64 our_king = b.pieces[c][KING];
            
            if (their_king && our_king) {
                int tk_sq = get_lsb(their_king);
                int ok_sq = get_lsb(our_king);
                
                int tk_r = tk_sq / 8;
                int tk_c = tk_sq % 8;
                
                // Reward pushing enemy king to the edges (corners are best: 0,0 0,7 7,0 7,7)
                int center_dist_r = std::max(abs(tk_r - 3), abs(tk_r - 4));
                int center_dist_c = std::max(abs(tk_c - 3), abs(tk_c - 4));
                int mop_up_bonus = (center_dist_r + center_dist_c) * 100;
                
                // Reward bringing our King closer to the enemy King
                int ok_r = ok_sq / 8;
                int ok_c = ok_sq % 8;
                int king_dist = std::max(abs(tk_r - ok_r), abs(tk_c - ok_c));
                mop_up_bonus += (14 - king_dist) * 50;
                
                classical_score += mop_up_bonus * color_sign;
                if (tl_breakdown) tl_breakdown->king_safety += mop_up_bonus * color_sign;
            }
        }
    }
    
    int relative_classical = (b.side_to_move == WHITE) ? classical_score : -classical_score;
    

    
    int final_score = relative_classical + nnue_score;
    return final_score;
}
