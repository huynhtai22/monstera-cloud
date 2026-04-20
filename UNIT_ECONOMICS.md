# Unit Economics: Monstera Cloud (Projection)

## 1. Assumptions
- **Developer Hourly Rate:** $30/hr (Adjustable based on your market)
- **Active Users:** 50 (Targeting 50 paying agencies/SMEs)
- **Support Burden:** 1.5 hrs/month per paying customer
- **Infrastructure (Vercel Pro + Neon + Logs):** ~$150/month flat
- **API Egress/Partner Scrapers:** ~$0.05/user/month (estimated)

## 2. Monthly Cost Breakdown
| Category | Calculation | Monthly Cost (USD) |
| :--- | :--- | :--- |
| **Infrastructure** | Flat Vercel/DB/Logging | $150.00 |
| **Operations** | 50 users * 1.5 hrs * $30/hr | $2,250.00 |
| **API/Egress** | 50 users * $0.05 | $2.50 |
| **Total Cost** | | **$2,402.50** |

## 3. Revenue vs. Profitability
- **Pricing:** Starter (299k ~ $12), Professional (699k ~ $28)
- **Revenue Mix (Assuming 70% Starter, 30% Pro):**
    - 35 Starter Users * $12 = $420
    - 15 Pro Users * $28 = $420
    - **Total Monthly Revenue: $840.00**

## 4. The Verdict
- **Monthly Net:** -$1,562.50 (You are losing money)
- **Breakeven Point:** You need ~150 Professional users or ~350 Starter users to simply cover your "human labor" cost at your target rate.

## 5. Strategic Pivots to Fix Economics
1. **Reduce Support (The "Self-Serve" Shift):** Your support time (1.5 hrs/user) is your biggest cost. You must automate the "Why isn't my connection working?" answer. *Build an automated health-check report the user can see in the add-on.*
2. **Move to Consumption Pricing:** Don't sell "plans." Sell "credits." 
   - 10k rows = 1 credit.
   - User buys 500 credits for 699k VND. This protects your margins as their data volume grows.
3. **Agency Model:** If you onboard 1 Agency (with 10 clients), you support **1 person (the agency owner)**, not 10 people. The Agency model scales infinitely better than the SME model.
