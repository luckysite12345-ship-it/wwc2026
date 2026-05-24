const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const crypto = require('crypto');
console.log('agents.js loaded');
// ==========================
// CONVERT COMMISSION
// ==========================
router.post('/api/convert-commission', async (req, res) => {

    if (!req.session.user) {
        return res.status(401).json({
            error: 'Unauthorized'
        });
    }

    const userId = req.session.user.id;
    const { amount } = req.body;

    if (!amount || Number(amount) <= 0) {
        return res.status(400).json({
            error: 'Invalid amount'
        });
    }

    const client = await pool.connect();

    try {

        await client.query('BEGIN');

        // Get user
        const userResult = await client.query(`
            SELECT 
                id,
                parent_id,
                points,
                commission_earnings
            FROM users
            WHERE id=$1
            FOR UPDATE
        `, [userId]);

        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }

        const user = userResult.rows[0];

        // No parent
        if (!user.parent_id) {
            throw new Error(
                'No parent account available for conversion'
            );
        }

        // Check commission balance
        if (Number(user.commission_earnings) < Number(amount)) {
            throw new Error('Insufficient commission earnings');
        }

        // Get parent
        const parentResult = await client.query(`
            SELECT 
                id,
                points
            FROM users
            WHERE id=$1
            FOR UPDATE
        `, [user.parent_id]);

        if (parentResult.rows.length === 0) {
            throw new Error('Parent account not found');
        }

        const parent = parentResult.rows[0];

        // Check parent points
        if (Number(parent.points) < Number(amount)) {
            throw new Error(
                'Parent account has insufficient points'
            );
        }

        // Deduct parent points
        const parentUpdate = await client.query(`
            UPDATE users
            SET points = points - $1,
                updated_at = NOW()
            WHERE id=$2
            RETURNING points
        `, [amount, parent.id]);

        // Add child points + deduct commission
        const childUpdate = await client.query(`
            UPDATE users
            SET 
                points = points + $1,
                commission_earnings = commission_earnings - $1,
                updated_at = NOW()
            WHERE id=$2
            RETURNING points
        `, [amount, userId]);

        const referenceId = crypto.randomUUID();

        // Parent wallet log
        await client.query(`
            INSERT INTO wallet_transactions (
                user_id,
                type,
                amount,
                balance_after,
                description,
                reference_id
            )
            VALUES ($1,$2,$3,$4,$5,$6)
        `, [
            parent.id,
            'debit',
            amount,
            parentUpdate.rows[0].points,
            `Commission conversion transfer to agent ID ${userId}`,
            referenceId
        ]);

        // Child wallet log
        await client.query(`
            INSERT INTO wallet_transactions (
                user_id,
                type,
                amount,
                balance_after,
                description,
                reference_id
            )
            VALUES ($1,$2,$3,$4,$5,$6)
        `, [
            userId,
            'credit',
            amount,
            childUpdate.rows[0].points,
            'Commission converted to points',
            referenceId
        ]);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Commission converted successfully'
        });

    } catch (err) {

        await client.query('ROLLBACK');

        console.error(err);

        res.status(400).json({
            error: err.message
        });

    } finally {
        client.release();
    }
});

function buildTree(rows, rootId) {
    const map = {};
    let root = null;

    // create map
    rows.forEach(row => {
        map[row.id] = { ...row, children: [] };
    });

    // build hierarchy
    rows.forEach(row => {
        if (Number(row.id) === Number(rootId)) {
            root = map[row.id];
        } else if (row.parent_id && map[row.parent_id]) {
            map[row.parent_id].children.push(map[row.id]);
        }
    });

    return root;
}
router.get('/network-tree/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await pool.query(`
            WITH RECURSIVE tree AS (
                SELECT id, username, role, parent_id
                FROM users
                WHERE id = $1

                UNION ALL

                SELECT u.id, u.username, u.role, u.parent_id
                FROM users u
                INNER JOIN tree t ON u.parent_id = t.id
            )
            SELECT * FROM tree;
        `, [userId]);

        const rows = result.rows;

        // 👉 convert flat list into nested tree
        const tree = buildTree(rows, userId);

        res.json(tree);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load network" });
    }
});