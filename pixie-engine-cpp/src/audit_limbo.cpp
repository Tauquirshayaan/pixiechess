#include "audit_limbo.h"
#include "evaluate.h"
#include "search.h"
#include "movegen.h"
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>

struct DropAudit {
    Move move;
    std::string move_str;
    int static_eval;
    int search_eval;
    int best_move_delta;
    bool entered_pv;
    
    // Deltas (Drop - Limbo)
    int d_material;
    int d_mobility;
    int d_king_safety;
    int d_center_control;
    int d_threats;
    int d_development;
    int d_power_potential;
    int d_total;
    
    // Tactics
    bool is_check;
    bool is_capture;
    
    // Opportunity Metrics
    int post_legal_moves;
    int post_safe_mobility;
};

void audit_limbo_transition(Board& b) {
    try {
        std::cout << "info string starting audit_limbo_transition" << std::endl;
        Color us = b.side_to_move;
        
        // 1. Get Base Evaluation
        EvaluationBreakdown base_bd = explain_evaluation(b);
        int base_static = evaluate(b);
        
        // 2. Search for the Engine's Best Move (Depth 8)
        search_stop_flag = false;
        std::vector<std::pair<Move, int>> base_search = search_best_move(b, 8, 1, 1);
        int base_search_score = -100000;
        Move engine_best_move = Move(0,0,0,0,0,0,0);
        
        if (!base_search.empty()) {
            engine_best_move = base_search[0].first;
            base_search_score = base_search[0].second;
        }
    
    // 3. Generate all moves
    MoveList ml;
    generate_pseudo_legal_moves(b, ml);
    generate_pixie_moves(b, ml);
    
    std::vector<DropAudit> audits;
    
    for (int i = 0; i < ml.count; i++) {
        Move m = ml.moves[i];
        
        // Filter for Knightmare drops
        // from == to, piece == KNIGHTMARE, is_ability == false, from < 64
        if (m.piece() == KNIGHTMARE && m.from() == m.to() && !m.is_ability() && m.from() < 64) {
            
            // Validate pseudo-legal move
            Board* temp_b = new Board(b);
            temp_b->do_move(m);
            if (temp_b->in_check(us)) {
                delete temp_b;
                continue; // Illegal move
            }
            
            DropAudit audit;
            audit.move = m;
            audit.move_str = format_move(m);
            
            // Static Evaluation after drop
            EvaluationBreakdown post_bd = explain_evaluation(*temp_b);
            audit.static_eval = evaluate(*temp_b) * (us == WHITE ? 1 : -1); // Perspective of side to move
            
            // Deltas
            audit.d_material = post_bd.material - base_bd.material;
            audit.d_mobility = post_bd.mobility - base_bd.mobility;
            audit.d_king_safety = post_bd.king_safety - base_bd.king_safety;
            audit.d_center_control = post_bd.center_control - base_bd.center_control;
            audit.d_threats = post_bd.threats - base_bd.threats;
            audit.d_development = post_bd.development - base_bd.development;
            audit.d_power_potential = post_bd.power_potential - base_bd.power_potential;
            audit.d_total = post_bd.total() - base_bd.total();
            
            // Flip deltas if Black, so positive means "better for the player dropping"
            if (us == BLACK) {
                audit.d_material = -audit.d_material;
                audit.d_mobility = -audit.d_mobility;
                audit.d_king_safety = -audit.d_king_safety;
                audit.d_center_control = -audit.d_center_control;
                audit.d_threats = -audit.d_threats;
                audit.d_development = -audit.d_development;
                audit.d_power_potential = -audit.d_power_potential;
                audit.d_total = -audit.d_total;
            }
            
            // Tactics
            audit.is_check = temp_b->in_check(temp_b->side_to_move);
            audit.is_capture = m.is_capture();
            
            // Opportunity Metrics
            MoveList post_ml;
            generate_pseudo_legal_moves(*temp_b, post_ml);
            generate_pixie_moves(*temp_b, post_ml);
            int legal_count = 0;
            for (int j = 0; j < post_ml.count; j++) {
                Board* t2 = new Board(*temp_b);
                t2->do_move(post_ml.moves[j]);
                if (!t2->in_check(temp_b->side_to_move)) legal_count++;
                delete t2;
            }
            audit.post_legal_moves = legal_count;
            audit.post_safe_mobility = post_bd.mobility * (temp_b->side_to_move == WHITE ? 1 : -1);
            
            // Search Evaluation (Depth 8 for the dropped position)
            search_stop_flag = false;
            std::vector<std::pair<Move, int>> post_search = search_best_move(*temp_b, 8, 1, 1);
            int post_search_score = -100000;
            if (!post_search.empty()) {
                post_search_score = -post_search[0].second;
            }
            audit.search_eval = post_search_score;
            
            delete temp_b;
            
            // Delta from Base Best Move
            // If base best move was +1500, and this is +1400, delta is -100
            audit.best_move_delta = post_search_score - base_search_score;
            
            // Is it the best move? (Did it enter PV?)
            audit.entered_pv = false;
            if (audit.move.data == engine_best_move.data) {
                audit.entered_pv = true;
            } else if (post_search_score >= base_search_score - 10) {
                audit.entered_pv = true;
            }
            
            audits.push_back(audit);
        }
    }
    
    // Sort by Highest Search Evaluation (descending)
    std::sort(audits.begin(), audits.end(), [](const DropAudit& a, const DropAudit& b) {
        return a.search_eval > b.search_eval;
    });
    
    // Output JSON
    std::cout << "{\n";
    std::cout << "  \"engineBestMove\": \"" << format_move(engine_best_move) << "\",\n";
    std::cout << "  \"baseStaticEval\": " << (base_static * (us == WHITE ? 1 : -1)) << ",\n";
    std::cout << "  \"baseSearchEval\": " << base_search_score << ",\n";
    std::cout << "  \"drops\": [\n";
    
    for (size_t i = 0; i < audits.size(); i++) {
        const DropAudit& a = audits[i];
        std::cout << "    {\n";
        std::cout << "      \"move\": \"" << a.move_str << "\",\n";
        std::cout << "      \"staticEval\": " << a.static_eval << ",\n";
        std::cout << "      \"searchEval\": " << a.search_eval << ",\n";
        std::cout << "      \"bestMoveDelta\": " << a.best_move_delta << ",\n";
        std::cout << "      \"enteredPV\": " << (a.entered_pv ? "true" : "false") << ",\n";
        std::cout << "      \"bucketDelta\": {\n";
        std::cout << "        \"material\": " << a.d_material << ",\n";
        std::cout << "        \"mobility\": " << a.d_mobility << ",\n";
        std::cout << "        \"kingSafety\": " << a.d_king_safety << ",\n";
        std::cout << "        \"centerControl\": " << a.d_center_control << ",\n";
        std::cout << "        \"threats\": " << a.d_threats << ",\n";
        std::cout << "        \"development\": " << a.d_development << ",\n";
        std::cout << "        \"powerPotential\": " << a.d_power_potential << ",\n";
        std::cout << "        \"total\": " << a.d_total << "\n";
        std::cout << "      },\n";
        std::cout << "      \"tactics\": {\n";
        std::cout << "        \"check\": " << (a.is_check ? "true" : "false") << ",\n";
        std::cout << "        \"capture\": " << (a.is_capture ? "true" : "false") << "\n";
        std::cout << "      },\n";
        std::cout << "      \"opportunity\": {\n";
        std::cout << "        \"legalMoves\": " << a.post_legal_moves << "\n";
        std::cout << "      }\n";
        std::cout << "    }" << (i == audits.size() - 1 ? "" : ",") << "\n";
    }
    
    std::cout << "  ]\n";
    std::cout << "}\n";
    std::cout << std::endl; // Flush output
    } catch (const std::exception& e) {
        std::cerr << "Exception in audit_limbo_transition: " << e.what() << std::endl;
    } catch (...) {
        std::cerr << "Unknown exception in audit_limbo_transition" << std::endl;
    }
}
