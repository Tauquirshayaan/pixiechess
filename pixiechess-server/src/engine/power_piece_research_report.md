# Phase 15 Refinement: Evaluation Research Platform

**Positions Evaluated**: 12
**Tested Depths**: 4, 6

## Global Regression Fingerprint

### Evaluation Topology
| Metric | Aggregate |
|---|---|
| material imbalance | 23.3 |
| open files | 1.7 |
| semi open files | 0.6 |
| pawn islands | 0.0 |
| passed pawns | 0.0 |
| king exposure | 0.0 |
| doubled pawns | 0.1 |
| isolated pawns | 0.0 |
| connected pawns | 0.0 |
| center occupancy | 1.8 |
| knightmares in limbo | 0.3 |
| alive knightmare | 0.5 |
| alive marauder | 0.0 |
| alive phaserook | 0.0 |
| alive electroknight | 0.0 |
| alive djinn | 0.0 |
| alive basilisk | 0.0 |
| material | 0.0 cp |
| mobility | -3.3 cp |
| center control | -1.6 cp |
| development | 0.6 cp |
| threats | 2.9 cp |
| king safety | 14.8 cp |

### Search Profiling
| Metric | Average |
|---|---|
| nodes | 87475.0 |
| seldepth | 21.8 |
| tt hits | 15592.8 |
| beta cutoffs | 13823.3 |
| null move prunes | 20.3 |
| qnodes | 103405.3 |
| fail highs | 13823.3 |
| fail lows | 3038.6 |
| branching factor sum | 106989.9 |
| pv changes | 6.8 |

---

## Class: Standard (n=8)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| ambush platform | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| deployment readiness | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| behind king pressure | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| trapped penalty | `░` | 0.0 | 0.0 | 0% | Candidate Review |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: -15.5 cp
- **Impact Median**: -30.5 cp
- **Impact 95th %ile**: 120.0 cp
- **Impact StdDev**: 64.2 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: -54.6 cp

### Search Context & Decision Stability
- **Stability Score**: 75/100
- **Average TT Hits**: 6423
- **Average Beta Cutoffs**: 5301
- **Average Fail Highs**: 5301
- **Average Fail Lows**: 1126
- **Average QNodes**: 42149

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Opening (n=6)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `██████████` | 31.5 | 31.6 | 50% | Investigate |
| ambush platform | `██` | 7.7 | 7.7 | 50% | Investigate |
| deployment readiness | `█` | 0.0 | 0.0 | 0% | Investigate |
| behind king pressure | `█` | 0.0 | 0.0 | 0% | Investigate |
| trapped penalty | `███` | 10.0 | 10.0 | 50% | Investigate |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: 339.7 cp
- **Impact Median**: 282.5 cp
- **Impact 95th %ile**: 1005.0 cp
- **Impact StdDev**: 386.9 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: 146.5 cp

### Search Context & Decision Stability
- **Stability Score**: 80/100
- **Average TT Hits**: 6135
- **Average Beta Cutoffs**: 5926
- **Average Fail Highs**: 5926
- **Average Fail Lows**: 1135
- **Average QNodes**: 36988

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Open Position (n=1)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `░` | 0.0 | 0.0 | 0% | Keep |
| ambush platform | `░` | 0.0 | 0.0 | 0% | Keep |
| deployment readiness | `░` | 0.0 | 0.0 | 0% | Keep |
| behind king pressure | `░` | 0.0 | 0.0 | 0% | Keep |
| trapped penalty | `░` | 0.0 | 0.0 | 0% | Keep |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: 42.0 cp
- **Impact Median**: 42.0 cp
- **Impact 95th %ile**: 42.0 cp
- **Impact StdDev**: 0.0 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: -12.0 cp

### Search Context & Decision Stability
- **Stability Score**: 70/100
- **Average TT Hits**: 8218
- **Average Beta Cutoffs**: 7071
- **Average Fail Highs**: 7071
- **Average Fail Lows**: 1488
- **Average QNodes**: 53580

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Middlegame (n=3)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `░` | 0.0 | 0.0 | 0% | Keep |
| ambush platform | `░` | 0.0 | 0.0 | 0% | Keep |
| deployment readiness | `░` | 0.0 | 0.0 | 0% | Keep |
| behind king pressure | `░` | 0.0 | 0.0 | 0% | Keep |
| trapped penalty | `░` | 0.0 | 0.0 | 0% | Keep |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: 17.0 cp
- **Impact Median**: -11.0 cp
- **Impact 95th %ile**: 120.0 cp
- **Impact StdDev**: 75.3 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: -38.0 cp

### Search Context & Decision Stability
- **Stability Score**: 63/100
- **Average TT Hits**: 8558
- **Average Beta Cutoffs**: 7020
- **Average Fail Highs**: 7020
- **Average Fail Lows**: 1759
- **Average QNodes**: 70149

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Closed Center (n=2)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `░` | 0.0 | 0.0 | 0% | Keep |
| ambush platform | `░` | 0.0 | 0.0 | 0% | Keep |
| deployment readiness | `░` | 0.0 | 0.0 | 0% | Keep |
| behind king pressure | `░` | 0.0 | 0.0 | 0% | Keep |
| trapped penalty | `░` | 0.0 | 0.0 | 0% | Keep |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: 33.0 cp
- **Impact Median**: 33.0 cp
- **Impact 95th %ile**: 120.0 cp
- **Impact StdDev**: 87.0 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: 56.5 cp

### Search Context & Decision Stability
- **Stability Score**: 70/100
- **Average TT Hits**: 9450
- **Average Beta Cutoffs**: 7835
- **Average Fail Highs**: 7835
- **Average Fail Lows**: 1433
- **Average QNodes**: 67461

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Endgame (n=3)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `███` | 2.3 | 3.3 | 33% | Investigate |
| ambush platform | `█` | 0.0 | 0.0 | 0% | Investigate |
| deployment readiness | `█` | 0.0 | 0.0 | 0% | Investigate |
| behind king pressure | `█` | 0.0 | 0.0 | 0% | Investigate |
| trapped penalty | `██████████` | 6.7 | 9.4 | 33% | Investigate |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: 174.7 cp
- **Impact Median**: -34.0 cp
- **Impact 95th %ile**: 660.0 cp
- **Impact StdDev**: 344.3 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: -189.3 cp

### Search Context & Decision Stability
- **Stability Score**: 83/100
- **Average TT Hits**: 1398
- **Average Beta Cutoffs**: 756
- **Average Fail Highs**: 756
- **Average Fail Lows**: 258
- **Average QNodes**: 1572

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Pawn Structure (n=1)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| ambush platform | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| deployment readiness | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| behind king pressure | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| trapped penalty | `░` | 0.0 | 0.0 | 0% | Candidate Review |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: -34.0 cp
- **Impact Median**: -34.0 cp
- **Impact 95th %ile**: -34.0 cp
- **Impact StdDev**: 0.0 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: -114.0 cp

### Search Context & Decision Stability
- **Stability Score**: 100/100
- **Average TT Hits**: 1575
- **Average Beta Cutoffs**: 870
- **Average Fail Highs**: 870
- **Average Fail Lows**: 300
- **Average QNodes**: 1667

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Power Pieces (n=4)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `██████████` | 49.0 | 24.4 | 100% | Investigate |
| ambush platform | `██` | 11.5 | 6.7 | 75% | Investigate |
| deployment readiness | `█` | 0.0 | 0.0 | 0% | Investigate |
| behind king pressure | `█` | 0.0 | 0.0 | 0% | Investigate |
| trapped penalty | `████` | 20.0 | 0.0 | 100% | Investigate |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: 684.3 cp
- **Impact Median**: 604.5 cp
- **Impact 95th %ile**: 1005.0 cp
- **Impact StdDev**: 192.2 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: 158.5 cp

### Search Context & Decision Stability
- **Stability Score**: 80/100
- **Average TT Hits**: 3824
- **Average Beta Cutoffs**: 4119
- **Average Fail Highs**: 4119
- **Average Fail Lows**: 963
- **Average QNodes**: 24975

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Knightmare Dominance (n=2)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `██████████` | 36.5 | 29.5 | 100% | Investigate |
| ambush platform | `██` | 8.0 | 8.0 | 50% | Investigate |
| deployment readiness | `█` | 0.0 | 0.0 | 0% | Investigate |
| behind king pressure | `█` | 0.0 | 0.0 | 0% | Investigate |
| trapped penalty | `█████` | 20.0 | 0.0 | 100% | Investigate |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: 832.5 cp
- **Impact Median**: 832.5 cp
- **Impact 95th %ile**: 1005.0 cp
- **Impact StdDev**: 172.5 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: -346.5 cp

### Search Context & Decision Stability
- **Stability Score**: 90/100
- **Average TT Hits**: 2561
- **Average Beta Cutoffs**: 3548
- **Average Fail Highs**: 3548
- **Average Fail Lows**: 1020
- **Average QNodes**: 19275

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Phaserook (n=1)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `██████████` | 64.0 | 0.0 | 100% | Investigate |
| ambush platform | `██` | 16.0 | 0.0 | 100% | Investigate |
| deployment readiness | `█` | 0.0 | 0.0 | 0% | Investigate |
| behind king pressure | `█` | 0.0 | 0.0 | 0% | Investigate |
| trapped penalty | `███` | 20.0 | 0.0 | 100% | Investigate |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: 549.0 cp
- **Impact Median**: 549.0 cp
- **Impact 95th %ile**: 549.0 cp
- **Impact StdDev**: 0.0 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: 473.0 cp

### Search Context & Decision Stability
- **Stability Score**: 70/100
- **Average TT Hits**: 7064
- **Average Beta Cutoffs**: 6307
- **Average Fail Highs**: 6307
- **Average Fail Lows**: 1211
- **Average QNodes**: 40712

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: Fission Reactor (n=1)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `██████████` | 59.0 | 0.0 | 100% | Investigate |
| ambush platform | `██` | 14.0 | 0.0 | 100% | Investigate |
| deployment readiness | `█` | 0.0 | 0.0 | 0% | Investigate |
| behind king pressure | `█` | 0.0 | 0.0 | 0% | Investigate |
| trapped penalty | `███` | 20.0 | 0.0 | 100% | Investigate |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: 523.0 cp
- **Impact Median**: 523.0 cp
- **Impact 95th %ile**: 523.0 cp
- **Impact StdDev**: 0.0 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: 854.0 cp

### Search Context & Decision Stability
- **Stability Score**: 70/100
- **Average TT Hits**: 3109
- **Average Beta Cutoffs**: 3073
- **Average Fail Highs**: 3073
- **Average Fail Lows**: 600
- **Average QNodes**: 20638

### Principal Variation Attribution
- **Appears in PV**: 0%

---

## Class: King Attack (n=1)

### Component Diagnostics & Recommendations
| Component | Heatmap | Mean | StdDev | Active % | Recommendation |
|-----------|---------|------|--------|----------|----------------|
| limbo persistence | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| ambush platform | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| deployment readiness | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| behind king pressure | `░` | 0.0 | 0.0 | 0% | Candidate Review |
| trapped penalty | `░` | 0.0 | 0.0 | 0% | Candidate Review |

### Counterfactual Confidence Distribution
- **Target**: Knightmare
- **Impact Mean**: -11.0 cp
- **Impact Median**: -11.0 cp
- **Impact 95th %ile**: -11.0 cp
- **Impact StdDev**: 0.0 cp

### Synergy Matrix (Normalized)
- **Knightmare + Mobility Interaction Score**: -6.0 cp

### Search Context & Decision Stability
- **Stability Score**: 70/100
- **Average TT Hits**: 9777
- **Average Beta Cutoffs**: 8030
- **Average Fail Highs**: 8030
- **Average Fail Lows**: 2239
- **Average QNodes**: 76622

### Principal Variation Attribution
- **Appears in PV**: 0%

---

