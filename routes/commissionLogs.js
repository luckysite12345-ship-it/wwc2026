const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// ==========================
// Middleware
// ==========================
function isAuthenticated(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            error: 'Unauthorized'
        });
    }

    next();
}

// ==========================
// COMMISSION TRANSACTIONS API
// ==========================
router.get('/my-commission-transactions', isAuthenticated, async (req, res) => {

    try {

        const userId = req.session.user.id;
        const role = req.session.user.role;

        const {
            search = '',
            from,
            to,
            page = 1,
            limit = 20
        } = req.query;

        const currentPage = parseInt(page);
        const pageLimit = parseInt(limit);
        const offset = (currentPage - 1) * pageLimit;

        let whereClause = `WHERE ct.status = 0`;
        const params = [];
        let i = 1;

        // ==========================
        // USER FILTER
        // ==========================
        if (role !== '-1') {
            whereClause += ` AND ct.user_id = $${i}`;
            params.push(userId);
            i++;
        }

        // ==========================
        // SEARCH
        // ==========================
        if (search) {
            whereClause += `
                AND (
                    u.username ILIKE $${i}
                    OR CAST(g.fight_number AS TEXT) ILIKE $${i}
                )
            `;

            params.push(`%${search}%`);
            i++;
        }

        // ==========================
        // FROM DATE
        // ==========================
        if (from) {
            whereClause += ` AND DATE(ct.created_at) >= $${i}`;
            params.push(from);
            i++;
        }

        // ==========================
        // TO DATE
        // ==========================
        if (to) {
            whereClause += ` AND DATE(ct.created_at) <= $${i}`;
            params.push(to);
            i++;
        }

        // ==========================
        // TOTAL COUNT
        // ==========================
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM commission_transactions ct
            LEFT JOIN users u ON u.id = ct.source_user_id
            LEFT JOIN games g ON g.id = ct.game_id
            ${whereClause}
        `;

        const countResult = await pool.query(countQuery, params);
        const totalRecords = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(totalRecords / pageLimit);

        // ==========================
        // MAIN QUERY
        // ==========================
        const query = `
            SELECT 
                ct.id,
                ct.amount,
                ct.rate,
                ct.level,
                ct.base_amount,
                ct.created_at,
                u.username AS source_username,
                g.fight_number AS game_fight
            FROM commission_transactions ct
            LEFT JOIN users u ON u.id = ct.source_user_id
            LEFT JOIN games g ON g.id = ct.game_id
            ${whereClause}
            ORDER BY ct.created_at DESC
            LIMIT $${i}
            OFFSET $${i + 1}
        `;

        const finalParams = [...params, pageLimit, offset];

        const result = await pool.query(query, finalParams);

        res.json({
            data: result.rows,
            pagination: {
                totalRecords,
                totalPages,
                currentPage,
                limit: pageLimit
            }
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

module.exports = router;