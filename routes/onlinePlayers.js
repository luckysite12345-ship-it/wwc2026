const express = require('express');
const router = express.Router();

const pool = require('../db/connection');

router.get('/online-players', async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                username,
                points
            FROM users
            WHERE status = 'online'
            AND role = 'player'
            AND points > 0
            ORDER BY points DESC
        `);

        res.json(result.rows);

    } catch(err) {

        console.error(err);

        res.status(500).json({
            error: 'Failed to fetch online players'
        });
    }
});

module.exports = router;