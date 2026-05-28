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
                b.id,
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
router.get('/bet-wallet-history/:betId', async (req, res) => {

    try {

        const { betId } = req.params;

        const betQuery = await pool.query(`
            SELECT user_id
            FROM bets
            WHERE id = $1
        `, [betId]);

        if (!betQuery.rows.length) {
            return res.status(404).json({
                error:'Bet not found'
            });
        }

        const userId = betQuery.rows[0].user_id;

        const history = await pool.query(`
            SELECT
                type,
                amount,
                balance_after,
                description,
                created_at
            FROM wallet_transactions
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 10
        `, [userId]);

        res.json(history.rows);

    } catch(err){
        console.error(err);

        res.status(500).json({
            error:'Failed to fetch wallet history'
        });
    }
});
router.post('/remove-bet', async (req, res) => {

    const client = await pool.connect();

    try {

        await client.query('BEGIN');

        const { betId } = req.body;

        const betQuery = await client.query(`
            SELECT *
            FROM bets
            WHERE id = $1
            FOR UPDATE
        `, [betId]);

        if (!betQuery.rows.length) {

            await client.query('ROLLBACK');

            return res.status(404).json({
                error:'Bet not found'
            });
        }

        const bet = betQuery.rows[0];

        // ✅ REFUND USER
        const walletQuery = await client.query(`
            SELECT COALESCE(balance_after,0) AS balance
            FROM wallet_transactions
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `, [bet.user_id]);

        const currentBalance =
            Number(walletQuery.rows[0]?.balance || 0);

        const newBalance =
            currentBalance + Number(bet.amount);

        // ✅ CREDIT REFUND
        await client.query(`
            INSERT INTO wallet_transactions (
                user_id,
                type,
                amount,
                balance_after,
                description
            )
            VALUES ($1,'credit',$2,$3,$4)
        `, [
            bet.user_id,
            bet.amount,
            newBalance,
            `Bet removed refund - Bet ID ${bet.id}`
        ]);

        // ✅ DELETE COMMISSION REFERENCES FIRST
        await client.query(`
            DELETE FROM commission_transactions
            WHERE bet_id = $1
        `, [bet.id]);

        // ✅ DELETE BET
        await client.query(`
            DELETE FROM bets
            WHERE id = $1
        `, [bet.id]);

        await client.query('COMMIT');

        res.json({
            success:true
        });

    } catch(err){

        await client.query('ROLLBACK');

        console.error(err);

        res.status(500).json({
            error:'Failed to remove bet'
        });

    } finally {
        client.release();
    }
});
module.exports = router;