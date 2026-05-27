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

        const meron = await pool.query(`
            SELECT 
                u.username,
                b.amount,
                u.points
            FROM bets b
            JOIN users u ON u.id = b.user_id
            WHERE b.side = 'MERON'
            AND b.is_dummy = false
            AND u.role = 'player'
            AND b.game_id = $1
            ORDER BY b.created_at ASC
        `, [gameId]);

        const wala = await pool.query(`
            SELECT 
                u.username,
                b.amount,
                u.points
            FROM bets b
            JOIN users u ON u.id = b.user_id
            WHERE b.side = 'WALA'
            AND b.is_dummy = false
            AND u.role = 'player'
            AND b.game_id = $1
            ORDER BY b.created_at ASC
        `, [gameId]);

        const draw = await pool.query(`
            SELECT 
                u.username,
                b.amount,
                u.points
            FROM bets b
            JOIN users u ON u.id = b.user_id
            WHERE b.side = 'DRAW'
            AND b.is_dummy = false
            AND u.role = 'player'
            AND b.game_id = $1
            ORDER BY b.created_at ASC
        `, [gameId]);

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