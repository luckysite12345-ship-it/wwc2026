const express = require('express');
const router = express.Router();

const pool = require('../db/connection');

// ==========================
// CONVERT COMMISSION API
// ==========================
router.post('/convert-commission', async (req, res) => {

    console.log(req.body);

    const userId = Number(req.body.userId);
    const amount = Number(req.body.amount);

    console.log("PARSED USER ID:", userId);

    const currentUserId = req.session.user.id;

    const client = await pool.connect();

    try {

        await client.query('BEGIN');

        const userQuery = await client.query(
            `
            SELECT
                commission_earnings,
                parent_id
            FROM users
            WHERE id = $1
            `,
            [userId]
        );

        console.log("ROWS:", userQuery.rows);

        if (userQuery.rows.length === 0) {

            await client.query('ROLLBACK');

            return res.status(404).json({
                error: 'User not found'
            });
        }

        const user = userQuery.rows[0];

        if (Number(user.parent_id) !== Number(currentUserId)) {

            await client.query('ROLLBACK');

            return res.status(403).json({
                error: 'Not allowed'
            });
        }

        const available = Number(user.commission_earnings);

        if (isNaN(amount) || amount <= 0 || amount > available) {

            await client.query('ROLLBACK');

            return res.status(400).json({
                error: 'Invalid amount'
            });
        }

        await client.query(
            `
            UPDATE users
            SET commission_earnings = commission_earnings - $1
            WHERE id = $2
            `,
            [amount, userId]
        );

        await client.query(
            `
            UPDATE users
            SET points = points + $1
            WHERE id = $2
            `,
            [amount, userId]
        );

        await client.query('COMMIT');

        res.json({
            message: 'Commission converted successfully'
        });

    } catch (err) {

        await client.query('ROLLBACK');

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });

    } finally {

        client.release();

    }

});

module.exports = router;