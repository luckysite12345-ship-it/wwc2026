const express = require('express');
const router = express.Router();

const pool = require('../db/connection');
const { isAuthenticated } = require('../middleware/auth');

router.get('/current-bets', isAuthenticated, async (req, res) => {
    try {

        const meron = await pool.query(`
            SELECT u.username, b.amount
            FROM bets b
            JOIN users u ON u.id = b.user_id
            WHERE b.side = 'MERON'
            AND b.is_dummy = false
            AND u.role = 'player'
            AND b.game_id = (
                SELECT id FROM games
                ORDER BY created_at DESC
                LIMIT 1
            )
            ORDER BY b.created_at ASC
        `);

        const wala = await pool.query(`
            SELECT u.username, b.amount
            FROM bets b
            JOIN users u ON u.id = b.user_id
            WHERE b.side = 'WALA'
            AND b.is_dummy = false
            AND u.role = 'player'
            AND b.game_id = (
                SELECT id FROM games
                ORDER BY created_at DESC
                LIMIT 1
            )
            ORDER BY b.created_at ASC
        `);

        res.json({
            meron: meron.rows,
            wala: wala.rows
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: 'Failed to fetch bets'
        });
    }
});

module.exports = router;