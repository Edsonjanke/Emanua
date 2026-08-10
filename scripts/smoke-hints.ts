/**
 * Smoke manual (requer DATABASE_URL no .env):
 *   npm run db:init && npm run db:seed && npm run dev
 *   curl -c c.jar -X POST http://localhost:3002/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"ataize\",\"password\":\"emanua123\"}"
 *   curl -b c.jar http://localhost:3002/api/financeiro/fluxo
 *   curl -b c.jar -X POST http://localhost:3002/api/receitas-dia -H "Content-Type: application/json" -d "{\"data\":\"2026-08-10\",\"valor\":150,\"forma\":\"dinheiro\"}"
 *   curl -b c.jar -X POST http://localhost:3002/api/contas-pagar -H "Content-Type: application/json" -d "{\"descricao\":\"Aluguel\",\"valor\":1500,\"dataVencimento\":\"2026-08-15\",\"categoria\":\"Aluguel\"}"
 */
console.log("Veja o comentário no topo deste arquivo para o smoke via curl.");
