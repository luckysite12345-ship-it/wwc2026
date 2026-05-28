const express = require('express');
const router = express.Router();

const pool = require('../db/connection');

router.get('/current-bets', async (req, res) => {
    try {

        const gameQuery = await pool.query(`
            SELECT id
            FROM games
            ORDER BY created_at DESC
            LIMIT 1
        `);

        const gameId = gameQuery.rows[0]?.id;

        if (!gameId) {
            return res.json({
                meron: [],
                wala: [],
                draw: []
            });
        }

        // =========================
        // COMMON QUERY
        // =========================
        const query = `
            SELECT 
                u.username,
                b.amount,

                COALESCE(wt.balance_after, 0) AS points

            FROM bets b

            JOIN users u 
                ON u.id = b.user_id

            LEFT JOIN LATERAL (
                SELECT balance_after
                FROM wallet_transactions wt
                WHERE wt.user_id = u.id
                ORDER BY wt.created_at DESC
                LIMIT 1
            ) wt ON true

            WHERE b.side = $1
            AND b.is_dummy = false
            AND u.role = 'player'
            AND b.game_id = $2

            ORDER BY b.created_at ASC
        `;

        const meron = await pool.query(query, ['MERON', gameId]);

        const wala = await pool.query(query, ['WALA', gameId]);

        const draw = await pool.query(query, ['DRAW', gameId]);

        res.json({
            meron: meron.rows,
            wala: wala.rows,
            draw: draw.rows
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: 'Failed to fetch bets'
        });
    }
});

module.exports = router;