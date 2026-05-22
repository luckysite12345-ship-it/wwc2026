const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// =========================
// Middleware
// =========================
function isSuperAdmin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.session.user.role !== '-1') {
        return res.status(403).json({ error: "Forbidden" });
    }

    next();
}

// =========================
// Helper: map status counts
// =========================
function mapStatus(rows) {
    const map = {
        online: 0,
        offline: 0,
        pending: 0
    };

    rows.forEach(r => {
        if (map.hasOwnProperty(r.status)) {
            map[r.status] = Number(r.count);
        }
    });

    return map;
}

// =========================
// Route: Superadmin Dashboard
// =========================
router.get('/dashboard', isSuperAdmin, async (req, res) => {
    console.log("🔥 SUPERADMIN DASHBOARD HIT");

    try {
        // =========================
        // TOTAL COUNTS
        // =========================
        const agents = await pool.query(`
            SELECT COUNT(*) AS total
            FROM users
            WHERE role IN ('agent','sub_agent','master_agent')
        `);

        const players = await pool.query(`
            SELECT COUNT(*) AS total
            FROM users
            WHERE role = 'player'
        `);

        // =========================
        // STATUS COUNTS
        // =========================
        const agentStatus = await pool.query(`
            SELECT status, COUNT(*) AS count
            FROM users
            WHERE role IN ('agent','sub_agent','master_agent')
            GROUP BY status
        `);

        const playerStatus = await pool.query(`
            SELECT status, COUNT(*) AS count
            FROM users
            WHERE role = 'player'
            GROUP BY status
        `);

        // =========================
        // GAME FLOW (BETS & WINS)
        // =========================
        const gameFlow = await pool.query(`
            SELECT
                COALESCE(SUM(CASE 
                    WHEN type = 'debit' AND description ILIKE 'Bet on%' 
                    THEN amount ELSE 0 END), 0) AS total_bet,

                COALESCE(SUM(CASE 
                    WHEN type = 'credit' AND description ILIKE 'Win -%' 
                    THEN amount ELSE 0 END), 0) AS total_won
            FROM wallet_transactions
        `);

        // =========================
        // CASH FLOW (FIXED - BASED ON DESCRIPTION)
        // =========================
        const cash = await pool.query(`
            SELECT
                COALESCE(SUM(CASE 
                    WHEN description ILIKE 'Received%' 
                    THEN amount ELSE 0 END), 0) AS cash_in,

                COALESCE(SUM(CASE 
                    WHEN description ILIKE 'Withdrawal approved' 
                    THEN amount ELSE 0 END), 0) AS withdraw
            FROM wallet_transactions
        `);

        // =========================
        // MAP STATUS
        // =========================
        const agentMap = mapStatus(agentStatus.rows);
        const playerMap = mapStatus(playerStatus.rows);

        // =========================
        // GAME FLOW VALUES
        // =========================
        const totalBet = Number(gameFlow.rows[0]?.total_bet || 0);
        const totalWon = Number(gameFlow.rows[0]?.total_won || 0);
        const netGameFlow = totalBet - totalWon;
        
        const totalCashIn = Number(cash.rows[0]?.cash_in || 0);
        const totalWithdraw = Number(cash.rows[0]?.withdraw || 0);
        const netCashFlow = totalCashIn - totalWithdraw;
        // =========================
        // RESPONSE
        // =========================
        return res.json({
            totalAgents: Number(agents.rows[0]?.total || 0),
            totalPlayers: Number(players.rows[0]?.total || 0),

            // ✅ Game Flow
            totalBet: totalBet,           // raw bet
            totalWon: totalWon,           // wins
            netGameFlow: netGameFlow,     // BET - WON

            // ✅ Cash Flow (FIXED)
            totalCashIn: totalCashIn,
            totalWithdraw: totalWithdraw,
            netCashFlow: netCashFlow,

            // ✅ Agent status
            onlineAgents: agentMap.online,
            offlineAgents: agentMap.offline,
            pendingAgents: agentMap.pending,

            // ✅ Player status
            onlinePlayers: playerMap.online,
            offlinePlayers: playerMap.offline,
            pendingPlayers: playerMap.pending
        });

    } catch (err) {
        console.error("❌ SUPERADMIN ERROR:", err);
        return res.status(500).json({
            error: err.message,
            stack: err.stack
        });
    }
});
// =========================
// NETWORK API
// SHOW FULL DOWNLINE TREE
// =========================
router.get('/network/:id', isSuperAdmin, async (req, res) => {

    const { id } = req.params;

    try {

        const result = await pool.query(`
            WITH RECURSIVE network AS (

                -- DIRECT DOWNLINES ONLY (SAFE START)
                SELECT
                    u.id,
                    u.username,
                    u.role,
                    u.points,
                    u.status,
                    u.parent_id,
                    1 AS level
                FROM users u
                WHERE u.parent_id = $1

                UNION ALL

                -- NEXT LEVELS
                SELECT
                    child.id,
                    child.username,
                    child.role,
                    child.points,
                    child.status,
                    child.parent_id,
                    network.level + 1
                FROM users child
                INNER JOIN network
                    ON child.parent_id = network.id
            )

            SELECT
                n.id,
                n.username,
                n.role,
                n.points,
                n.status,
                n.level,
                p.username AS parent_username
            FROM network n
            LEFT JOIN users p
                ON n.parent_id = p.id

            ORDER BY n.level ASC, n.username ASC
        `, [id]);

        console.log("NETWORK RESULT:", result.rows);

        res.json(result.rows);

    } catch (err) {

        console.error("❌ NETWORK ERROR:", err);

        res.status(500).json({
            error: 'Failed to load network'
        });
    }
   
});
 router.get('/users-list', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, username, role
            FROM users
            WHERE role != 'declarator'
            ORDER BY username ASC
        `);

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load users' });
    }
});
router.get('/all-wallet-transactions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT username
            FROM wallet_transactions
            UNION
            SELECT username FROM users
            WHERE role != 'declarator'
            ORDER BY username ASC;
        `);

        res.json(result.rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load logs' });
    }
});
// =========================
// GAME ARCHIVES
// =========================
router.get('/game-archives', isSuperAdmin, async (req, res) => {

    try {

        const {
            search = '',
            from = '',
            to = '',
            limit = 25,
            page = 1,
            sort = 'id',
            order = 'DESC'
        } = req.query;

        const safeLimit =
            [25, 50, 100].includes(Number(limit))
                ? Number(limit)
                : 25;

        const offset =
            (Number(page) - 1) * safeLimit;

        const allowedSorts = [
            'id',
            'fight_number',
            'event_name',
            'winner',
            'created_at',
            'game_earning',
            'agent_commission_total',
            'meron_total',
            'wala_total',
            'draw_total'
        ];

        const safeSort =
            allowedSorts.includes(sort)
                ? sort
                : 'id';

        const safeOrder =
            order === 'ASC' ? 'ASC' : 'DESC';

        let conditions = [];
        let values = [];
        let index = 1;

        // =========================
        // SEARCH
        // =========================
        if (search) {

            conditions.push(`
                (
                    CAST(g.id AS TEXT) ILIKE $${index}
                    OR CAST(g.fight_number AS TEXT) ILIKE $${index}
                    OR g.event_name ILIKE $${index}
                )
            `);

            values.push(`%${search}%`);
            index++;
        }

        // =========================
        // FROM DATE
        // =========================
        if (from) {

            conditions.push(`
                DATE(g.created_at) >= $${index}
            `);

            values.push(from);
            index++;
        }

        // =========================
        // TO DATE
        // =========================
        if (to) {

            conditions.push(`
                DATE(g.created_at) <= $${index}
            `);

            values.push(to);
            index++;
        }

        const whereClause =
            conditions.length > 0
                ? `WHERE ${conditions.join(' AND ')}`
                : '';

        // =========================
        // TOTAL RECORDS
        // =========================
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM games g
            ${whereClause}
        `;

        const countResult =
            await pool.query(countQuery, values);

        const total =
            Number(countResult.rows[0].total);
        
            // =========================
        // TOTAL EARNINGS
        // =========================
        const earningsQuery = `

            SELECT

                COALESCE(SUM(

                    ROUND(

                        (
                            COALESCE(player_totals.total_bets, 0) * 0.915
                        )

                        -

                        CASE

                            WHEN g.winner = 'MERON'
                            THEN
                                COALESCE(player_totals.meron_total, 0)
                                *
                                COALESCE(
                                    g.meron_odds,
                                    g.winning_odds,
                                    0
                                )

                            WHEN g.winner = 'WALA'
                            THEN
                                COALESCE(player_totals.wala_total, 0)
                                *
                                COALESCE(
                                    g.wala_odds,
                                    g.winning_odds,
                                    0
                                )

                            ELSE 0

                        END

                        -

                        COALESCE(commissions.total_commission, 0)

                    ,2)

                ),0) AS total_earnings

            FROM games g

            LEFT JOIN (

                SELECT
                    b.game_id,

                    SUM(
                        CASE
                            WHEN u.role = 'player'
                            THEN b.amount
                            ELSE 0
                        END
                    ) AS total_bets,

                    SUM(
                        CASE
                            WHEN u.role = 'player'
                            AND b.side = 'MERON'
                            THEN b.amount
                            ELSE 0
                        END
                    ) AS meron_total,

                    SUM(
                        CASE
                            WHEN u.role = 'player'
                            AND b.side = 'WALA'
                            THEN b.amount
                            ELSE 0
                        END
                    ) AS wala_total

                FROM bets b

                LEFT JOIN users u
                    ON u.id = b.user_id

                WHERE b.is_dummy = false

                GROUP BY b.game_id

            ) player_totals
                ON player_totals.game_id = g.id

            LEFT JOIN (

                SELECT
                    game_id,
                    SUM(amount) AS total_commission
                FROM commission_transactions
                GROUP BY game_id

            ) commissions
                ON commissions.game_id = g.id

            ${whereClause}
        `;

        const earningsResult =
            await pool.query(
                earningsQuery,
                values
            );

        const totalEarnings =
            Number(
                earningsResult.rows[0]
                    .total_earnings || 0
            );
        // =========================
        // MAIN QUERY
        // =========================
        const query = `

            SELECT
                g.id,
                g.fight_number,
                g.event_name,
                g.winner,

                g.winning_odds,
                g.meron_odds,
                g.wala_odds,

                g.created_at,

                COALESCE(SUM(
                    CASE
                        WHEN u.role = 'player'
                        AND b.side = 'MERON'
                        THEN b.amount
                        ELSE 0
                    END
                ), 0) AS meron_total,

                COALESCE(SUM(
                    CASE
                        WHEN u.role = 'player'
                        AND b.side = 'WALA'
                        THEN b.amount
                        ELSE 0
                    END
                ), 0) AS wala_total,

                COALESCE(SUM(
                    CASE
                        WHEN u.role = 'player'
                        AND b.side = 'DRAW'
                        THEN b.amount
                        ELSE 0
                    END
                ), 0) AS draw_total,

                COALESCE(
                    (
                        SELECT SUM(ct.amount)
                        FROM commission_transactions ct
                        WHERE ct.game_id = g.id
                    ),
                0) AS agent_commission_total,

                ROUND(

                    (
                        COALESCE(SUM(
                            CASE
                                WHEN u.role = 'player'
                                THEN b.amount
                                ELSE 0
                            END
                        ),0) * 0.915
                    )

                    -

                    CASE

                        WHEN g.winner = 'MERON'
                        THEN

                            COALESCE(SUM(
                                CASE
                                    WHEN u.role = 'player'
                                    AND b.side = 'MERON'
                                    THEN b.amount
                                    ELSE 0
                                END
                            ),0)

                            *

                            COALESCE(
                                g.meron_odds,
                                g.winning_odds,
                                0
                            )

                        WHEN g.winner = 'WALA'
                        THEN

                            COALESCE(SUM(
                                CASE
                                    WHEN u.role = 'player'
                                    AND b.side = 'WALA'
                                    THEN b.amount
                                    ELSE 0
                                END
                            ),0)

                            *

                            COALESCE(
                                g.wala_odds,
                                g.winning_odds,
                                0
                            )

                        ELSE 0

                    END

                    -

                    COALESCE(
                        (
                            SELECT SUM(ct.amount)
                            FROM commission_transactions ct
                            WHERE ct.game_id = g.id
                        ),
                    0)

                ,2) AS game_earning

            FROM games g

            LEFT JOIN bets b
                ON b.game_id = g.id
                AND b.is_dummy = false

            LEFT JOIN users u
                ON u.id = b.user_id

            ${whereClause}

            GROUP BY
                g.id,
                g.fight_number,
                g.event_name,
                g.winner,
                g.winning_odds,
                g.meron_odds,
                g.wala_odds,
                g.created_at

            ORDER BY ${safeSort} ${safeOrder}

            LIMIT ${safeLimit}
            OFFSET ${offset}
        `;

        const result =
            await pool.query(query, values);

        res.json({
            rows: result.rows,
            total,
            totalEarnings
        });

    } catch (err) {

        console.error(
            "GAME ARCHIVES ERROR:",
            err
        );

        res.status(500).json({
            error: 'Failed to load game archives'
        });
    }
});
// =========================
// COMMISSION LOGS
// =========================
router.get(
    '/commission-transactions',
    isSuperAdmin,
    async (req, res) => {

    try {

        const {
            search = '',
            from = '',
            to = '',
            limit = 25,
            page = 1,
            sort = 'created_at',
            order = 'DESC'
        } = req.query;

        // =========================
        // SAFE LIMIT
        // =========================
        const safeLimit =
            [25, 50, 100].includes(Number(limit))
                ? Number(limit)
                : 25;

        const offset =
            (Number(page) - 1) * safeLimit;

        // =========================
        // SAFE SORT
        // =========================
        const allowedSorts = [
            'created_at',
            'source_username',
            'receiver_username',
            'base_amount',
            'rate',
            'amount',
            'level',
            'fight_number'
        ];

        const safeSort =
            allowedSorts.includes(sort)
                ? sort
                : 'created_at';

        const safeOrder =
            order === 'ASC'
                ? 'ASC'
                : 'DESC';

        // =========================
        // FILTERS
        // =========================
        let conditions = [];
        let values = [];
        let index = 1;

        // =========================
        // SEARCH
        // =========================
        if (search) {

            conditions.push(`

                (

                    source_user.username
                        ILIKE $${index}

                    OR

                    receiver_user.username
                        ILIKE $${index}

                    OR

                    CAST(g.fight_number AS TEXT)
                        ILIKE $${index}

                    OR

                    CAST(ct.game_id AS TEXT)
                        ILIKE $${index}

                )

            `);

            values.push(`%${search}%`);

            index++;

        }

        // =========================
        // FROM DATE
        // =========================
        if (from) {

            conditions.push(`
                DATE(ct.created_at) >= $${index}
            `);

            values.push(from);

            index++;

        }

        // =========================
        // TO DATE
        // =========================
        if (to) {

            conditions.push(`
                DATE(ct.created_at) <= $${index}
            `);

            values.push(to);

            index++;

        }

        const whereClause =
            conditions.length > 0
                ? `WHERE ${conditions.join(' AND ')}`
                : '';

        // =========================
        // TOTAL RECORDS
        // =========================
        const countQuery = `

            SELECT COUNT(*) AS total

            FROM commission_transactions ct

            LEFT JOIN users source_user
                ON source_user.id =
                    ct.source_user_id

            LEFT JOIN users receiver_user
                ON receiver_user.id =
                    ct.user_id

            LEFT JOIN games g
                ON g.id = ct.game_id

            ${whereClause}

        `;

        const countResult =
            await pool.query(
                countQuery,
                values
            );

        const total =
            Number(
                countResult.rows[0].total
            );

        // =========================
        // TOTAL COMMISSION
        // =========================
        const totalCommissionQuery = `

            SELECT

                COALESCE(
                    SUM(ct.amount),
                0) AS total_commission

            FROM commission_transactions ct

            LEFT JOIN users source_user
                ON source_user.id =
                    ct.source_user_id

            LEFT JOIN users receiver_user
                ON receiver_user.id =
                    ct.user_id

            LEFT JOIN games g
                ON g.id = ct.game_id

            ${whereClause}

        `;

        const totalCommissionResult =
            await pool.query(
                totalCommissionQuery,
                values
            );

        const totalCommission =
            Number(
                totalCommissionResult
                    .rows[0]
                    .total_commission || 0
            );

        // =========================
        // SORT COLUMN MAP
        // =========================
        const sortMap = {

            created_at:
                'ct.created_at',

            source_username:
                'source_user.username',

            receiver_username:
                'receiver_user.username',

            base_amount:
                'ct.base_amount',

            rate:
                'ct.rate',

            amount:
                'ct.amount',

            level:
                'ct.level',

            fight_number:
                'g.fight_number'

        };

        // =========================
        // MAIN QUERY
        // =========================
        const query = `

            SELECT

                ct.id,
                ct.created_at,
                ct.base_amount,
                ct.rate,
                ct.amount,
                ct.level,

                ct.game_id,

                source_user.username
                    AS source_username,

                receiver_user.username
                    AS receiver_username,

                g.fight_number

            FROM commission_transactions ct

            LEFT JOIN users source_user
                ON source_user.id =
                    ct.source_user_id

            LEFT JOIN users receiver_user
                ON receiver_user.id =
                    ct.user_id

            LEFT JOIN games g
                ON g.id = ct.game_id

            ${whereClause}

            ORDER BY
                ${sortMap[safeSort]}
                ${safeOrder}

            LIMIT ${safeLimit}
            OFFSET ${offset}

        `;

        const result =
            await pool.query(
                query,
                values
            );

        res.json({

            rows:
                result.rows,

            total,

            totalCommission,

            currentPage:
                Number(page),

            totalPages:
                Math.ceil(
                    total / safeLimit
                )

        });

    } catch (err) {

        console.error(
            'COMMISSION LOGS ERROR:',
            err
        );

        res.status(500).json({
            error:
                'Failed to load commission logs'
        });

    }

});
// =========================
// COMMISSION CONVERSION LOGS
// =========================
router.get(
  '/commission-conversions',
  isSuperAdmin,
  async (req, res) => {

    try {

      const page =
        parseInt(req.query.page) || 1;

      const limit =
        parseInt(req.query.limit) || 25;

      const offset =
        (page - 1) * limit;

      const search =
        req.query.search || '';

      const from =
        req.query.from || '';

      const to =
        req.query.to || '';

      let where = `
        WHERE wt.description ILIKE '%commission%'
      `;

      const values = [];
      let index = 1;

      // =========================
      // SEARCH
      // =========================
      if (search) {

        where += `
          AND (
            u.username ILIKE $${index}
          )
        `;

        values.push(`%${search}%`);

        index++;

      }

      // =========================
      // FROM DATE
      // =========================
      if (from) {

        where += `
          AND wt.created_at >= $${index}
        `;

        values.push(from);

        index++;

      }

      // =========================
      // TO DATE
      // =========================
      if (to) {

        where += `
          AND wt.created_at <= $${index}
        `;

        values.push(`${to} 23:59:59`);

        index++;

      }

      // =========================
      // TOTAL ROWS
      // =========================
      const totalQuery = await pool.query(
        `
          SELECT COUNT(*) AS total
          FROM wallet_transactions wt
          LEFT JOIN users u
          ON u.id = wt.user_id
          ${where}
        `,
        values
      );

      const total =
        Number(totalQuery.rows[0].total);

      // =========================
      // FETCH DATA
      // =========================
      values.push(limit);
      values.push(offset);

      const rowsQuery = await pool.query(
        `
          SELECT
            wt.id,
            wt.user_id,
            u.username,
            wt.amount,
            wt.balance_after,
            wt.description,
            wt.created_at
          FROM wallet_transactions wt
          LEFT JOIN users u
          ON u.id = wt.user_id
          ${where}
          ORDER BY wt.created_at DESC
          LIMIT $${index}
          OFFSET $${index + 1}
        `,
        values
      );

      res.json({

        rows: rowsQuery.rows,

        currentPage: page,

        totalPages:
          Math.ceil(total / limit),

        total

      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: 'Server error'
      });

    }

  }
);
module.exports = router;