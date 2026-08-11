---
target: painel inteiro
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
p2_count: 2
timestamp: 2026-08-11T22-13-23Z
slug: client-src-pages-painel-tsx
---
# Critique — Painel Financeiro (client/src/pages/painel.tsx)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Toasts ok; Reconciliar sem busy; status raw |
| 2 | Match System / Real World | 3 | Âncora/Reconciliar/DRE/DAS/PE pouco claros |
| 3 | User Control and Freedom | 2 | Pagar/Baixar sem confirm; Excluir A Receber sem confirm |
| 4 | Consistency and Standards | 2 | Modal vs inline create; Pagar vs Baixar |
| 5 | Error Prevention | 2 | CSV sem preview; pago em 1 clique |
| 6 | Recognition Rather Than Recall | 2 | Nomes de arquivos Gendo; Âncora sem ajuda |
| 7 | Flexibility and Efficiency | 1 | Sem atalhos, bulk, search, deep links |
| 8 | Aesthetic and Minimalist Design | 1 | Parede de 7 CTAs + métricas + gráfico |
| 9 | Error Recovery | 2 | toast.error genérico |
| 10 | Help and Documentation | 1 | Pouca orientação first-run |
| **Total** | | **19/40** | **Poor** |

## Design Specificity
LLM: Mostly category-interchangeable dark finance shell; login is most branded.
Detector: CLI 2× overused-font (Instrument Serif); browser 7 findings (low-contrast, tiny-text, tight-leading, layout-transition, em-dash suspect).

## Priority Issues
P1 Fluxo action wall — distill/shape
P1 High-stakes Pagar/Baixar/Excluir — harden
P1 Visual density Fluxo — layout/quieter
P2 A11y gaps — harden/audit
P2 Inconsistent patterns + jargon — clarify/onboard

## Personas
Alex: no shortcuts/bulk; Jordan: 3 import doors + Âncora; Sam: icon-only, outline-none, color-only meaning
