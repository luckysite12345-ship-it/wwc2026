const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const crypto = require('crypto');


// =======================================
// ADD POINTS (SUPERADMIN)
// =======================================
router.post('/sa/add-points', async (req, res) => {

    if (!req.session.user || req.session.user.role !== '-1') {
        return res.status(403).json({
            error: 'Unauthorized'
        });
    }

    const { userId, amount } = req.body;

    if (!userId || !amount || Number(amount) <= 0) {
        return res.status(400).json({
            error: 'Invalid amount'
        });
    }

    const client = await pool.connect();

    try {

        await client.query('BEGIN');

        const userResult = await client.query(`
            SELECT id, username, points
            FROM users
            WHERE id = $1
            FOR UPDATE
        `, [userId]);

        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }

        const player = userResult.rows[0];

        const newBalance =
            Number(player.points || 0) +
            Number(amount);

        await client.query(`
            UPDATE users
            SET points = $1,
                updated_at = NOW()
            WHERE id = $2
        `, [newBalance, userId]);

        await client.query(`
            INSERT INTO wallet_transactions
            (
                user_id,
                type,
                amount,
                balance_after,
                description,
                reference_id
            )
            VALUES
            (
                $1,
                'credit',
                $2,
                $3,
                $4,
                $5
            )
        `,
        [
            userId,
            amount,
            newBalance,
            `Added by Super Admin (${req.session.user.username})`,
            crypto.randomUUID()
        ]);

        await client.query('COMMIT');

        res.json({
            message: 'Points added successfully'
        });

    } catch (err) {

        await client.query('ROLLBACK');

        console.error(err);

        res.status(500).json({
            error: err.message
        });

    } finally {

        client.release();

    }

});


// =======================================
// WITHDRAW POINTS (SUPERADMIN)
// =======================================
router.post('/sa/withdraw-points', async (req, res) => {

    if (!req.session.user || req.session.user.role !== '-1') {
        return res.status(403).json({
            error: 'Unauthorized'
        });
    }

    const { userId, amount } = req.body;

    if (!userId || !amount || Number(amount) <= 0) {
        return res.status(400).json({
            error: 'Invalid amount'
        });
    }

    const client = await pool.connect();

    try {

        await client.query('BEGIN');

        const userResult = await client.query(`
            SELECT id, username, points
            FROM users
            WHERE id = $1
            FOR UPDATE
        `, [userId]);

        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }

        const player = userResult.rows[0];

        if (Number(player.points) < Number(amount)) {
            throw new Error('Insufficient player balance');
        }

        const newBalance =
            Number(player.points) -
            Number(amount);

        await client.query(`
            UPDATE users
            SET points = $1,
                updated_at = NOW()
            WHERE id = $2
        `, [newBalance, userId]);

        await client.query(`
            INSERT INTO wallet_transactions
            (
                user_id,
                type,
                amount,
                balance_after,
                description,
                reference_id
            )
            VALUES
            (
                $1,
                'debit',
                $2,
                $3,
                $4,
                $5
            )
        `,
        [
            userId,
            amount,
            newBalance,
            `Withdrawn by Super Admin (${req.session.user.username})`,
            crypto.randomUUID()
        ]);

        await client.query('COMMIT');

        res.json({
            message: 'Points withdrawn successfully'
        });

    } catch (err) {

        await client.query('ROLLBACK');

        console.error(err);

        res.status(500).json({
            error: err.message
        });

    } finally {

        client.release();

    }

});


// =======================================
// PLAYER -> AGENT
// =======================================
router.post('/sa/promote-player', async (req, res) => {

    if (!req.session.user || req.session.user.role !== '-1') {
        return res.status(403).json({
            error: 'Unauthorized'
        });
    }

    const { userId } = req.body;

    try {

        const player = await pool.query(`
            SELECT id, role
            FROM users
            WHERE id = $1
        `, [userId]);

        if (player.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        await pool.query(`
            UPDATE users
            SET role = 'agent',
                updated_at = NOW()
            WHERE id = $1
        `, [userId]);

        res.json({
            message: 'Player promoted to Agent'
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });

    }

});

module.exports = router;