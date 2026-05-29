const express = require('express');
const router = express.Router();

const pool = require('../db/connection');

// ==========================
// SUPERADMIN MIDDLEWARE
// ==========================
function isSuperAdmin(req, res, next) {

    if (!req.session.user) {
        return res.status(401).json({
            error: 'Unauthorized'
        });
    }

    // role = -1 => superadmin
    if (String(req.session.user.role) !== '-1') {
        return res.status(403).json({
            error: 'Forbidden'
        });
    }

    next();
}

// ==========================
// ADD POINTS
// ==========================
router.post('/add-points', isSuperAdmin, async (req, res) => {

    const { userId, amount } = req.body;

    const adminId = req.session.user.id;

    const client = await pool.connect();

    try {

        const points = Number(amount);

        if (!points || points <= 0) {
            return res.status(400).json({
                error: 'Invalid amount'
            });
        }

        await client.query('BEGIN');

        const userQuery = await client.query(`
            SELECT id, username, points
            FROM users
            WHERE id = $1
        `, [userId]);

        if (userQuery.rows.length === 0) {

            await client.query('ROLLBACK');

            return res.status(404).json({
                error: 'User not found'
            });
        }

        const user = userQuery.rows[0];

        const newBalance =
            Number(user.points) + points;

        // add points
        await client.query(`
            UPDATE users
            SET points = points + $1
            WHERE id = $2
        `, [points, userId]);

        // wallet logs
        await client.query(`
            INSERT INTO wallet_transactions
            (user_id, type, amount, balance_after, description)
            VALUES ($1, 'credit', $2, $3, $4)
        `, [
            userId,
            points,
            newBalance,
            `Superadmin added points`
        ]);

        await client.query('COMMIT');

        res.json({
            message: 'Points added successfully'
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

// ==========================
// WITHDRAW LOAD
// ==========================
router.post('/withdraw-load', isSuperAdmin, async (req, res) => {

    const { userId, amount } = req.body;

    const client = await pool.connect();

    try {

        const points = Number(amount);

        if (!points || points <= 0) {
            return res.status(400).json({
                error: 'Invalid amount'
            });
        }

        await client.query('BEGIN');

        const userQuery = await client.query(`
            SELECT id, username, points
            FROM users
            WHERE id = $1
        `, [userId]);

        if (userQuery.rows.length === 0) {

            await client.query('ROLLBACK');

            return res.status(404).json({
                error: 'User not found'
            });
        }

        const user = userQuery.rows[0];

        if (Number(user.points) < points) {

            await client.query('ROLLBACK');

            return res.status(400).json({
                error: 'Insufficient wallet'
            });
        }

        const newBalance =
            Number(user.points) - points;

        // deduct
        await client.query(`
            UPDATE users
            SET points = points - $1
            WHERE id = $2
        `, [points, userId]);

        // logs
        await client.query(`
            INSERT INTO wallet_transactions
            (user_id, type, amount, balance_after, description)
            VALUES ($1, 'debit', $2, $3, $4)
        `, [
            userId,
            points,
            newBalance,
            `Superadmin withdrew load`
        ]);

        await client.query('COMMIT');

        res.json({
            message: 'Load withdrawn successfully'
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

// ==========================
// CONVERT COMMISSION
// ==========================
router.post('/convert-commission', isSuperAdmin, async (req, res) => {

    const { userId, amount } = req.body;

    const client = await pool.connect();

    try {

        const convertAmount = Number(amount);

        if (!convertAmount || convertAmount <= 0) {
            return res.status(400).json({
                error: 'Invalid amount'
            });
        }

        await client.query('BEGIN');

        const userQuery = await client.query(`
            SELECT
                id,
                username,
                points,
                commission_earnings
            FROM users
            WHERE id = $1
        `, [userId]);

        if (userQuery.rows.length === 0) {

            await client.query('ROLLBACK');

            return res.status(404).json({
                error: 'User not found'
            });
        }

        const user = userQuery.rows[0];

        if (
            Number(user.commission_earnings)
            < convertAmount
        ) {

            await client.query('ROLLBACK');

            return res.status(400).json({
                error: 'Insufficient commission'
            });
        }

        // deduct commission
        await client.query(`
            UPDATE users
            SET commission_earnings =
                commission_earnings - $1
            WHERE id = $2
        `, [convertAmount, userId]);

        // add wallet
        await client.query(`
            UPDATE users
            SET points = points + $1
            WHERE id = $2
        `, [convertAmount, userId]);

        const newWallet =
            Number(user.points) + convertAmount;

        // logs
        await client.query(`
            INSERT INTO wallet_transactions
            (user_id, type, amount, balance_after, description)
            VALUES ($1, 'credit', $2, $3, $4)
        `, [
            userId,
            convertAmount,
            newWallet,
            `Commission converted by Superadmin`
        ]);

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

// ==========================
// UPDATE WALLET VALUE
// ==========================
router.post('/update-wallet', isSuperAdmin, async (req, res) => {

    const { userId, amount } = req.body;

    try {

        const wallet = Number(amount);

        if (wallet < 0) {
            return res.status(400).json({
                error: 'Invalid wallet'
            });
        }

        const userQuery = await pool.query(`
            SELECT username
            FROM users
            WHERE id = $1
        `, [userId]);

        if (userQuery.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        await pool.query(`
            UPDATE users
            SET points = $1
            WHERE id = $2
        `, [wallet, userId]);

        res.json({
            message: 'Wallet updated successfully'
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });

    }

});

// ==========================
// UPDATE EARNINGS
// ==========================
router.post('/update-earnings', isSuperAdmin, async (req, res) => {

    const { userId, amount } = req.body;

    try {

        const earnings = Number(amount);

        if (earnings < 0) {
            return res.status(400).json({
                error: 'Invalid earnings'
            });
        }

        const userQuery = await pool.query(`
            SELECT username
            FROM users
            WHERE id = $1
        `, [userId]);

        if (userQuery.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        await pool.query(`
            UPDATE users
            SET commission_earnings = $1
            WHERE id = $2
        `, [earnings, userId]);

        res.json({
            message: 'Earnings updated successfully'
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });

    }

});

// ==========================
// UPDATE COMMISSION RATE
// ==========================
router.post('/update-commission', isSuperAdmin, async (req, res) => {

    const { userId, rate } = req.body;

    try {

        const commission = Number(rate);

        if (
            isNaN(commission) ||
            commission < 0 ||
            commission > 100
        ) {
            return res.status(400).json({
                error: 'Invalid commission rate'
            });
        }

        const userQuery = await pool.query(`
            SELECT username
            FROM users
            WHERE id = $1
        `, [userId]);

        if (userQuery.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        await pool.query(`
            UPDATE users
            SET commission_rate = $1
            WHERE id = $2
        `, [commission, userId]);

        res.json({
            message: 'Commission updated successfully'
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });

    }

});

// ==========================
// TOGGLE STATUS
// ==========================
router.post('/toggle-status', isSuperAdmin, async (req, res) => {

    const { userId, status } = req.body;

    try {

        const allowed = [
            'online',
            'offline',
            'suspended'
        ];

        if (!allowed.includes(status)) {
            return res.status(400).json({
                error: 'Invalid status'
            });
        }

        const userQuery = await pool.query(`
            SELECT username
            FROM users
            WHERE id = $1
        `, [userId]);

        if (userQuery.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        await pool.query(`
            UPDATE users
            SET status = $1
            WHERE id = $2
        `, [status, userId]);

        res.json({
            message: 'Status updated successfully'
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });

    }

});

module.exports = router;