// ============================================================
// A1TV v2 — JWT Authentication Service
// Register, Login, Refresh Token, Device linking
// ============================================================

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const config = require('../config');

const JWT_SECRET = process.env.JWT_SECRET || 'a1tv_production_secret_change_me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'a1tv_refresh_secret_change_me';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

class AuthService {
    /**
     * Register a new user.
     */
    async register({ email, username, password, displayName }) {
        if (!email && !username) throw new Error('Email or username required');
        if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

        const passwordHash = await bcrypt.hash(password, 12);

        try {
            const [user] = await db('users').insert({
                email: email || null,
                username: username || null,
                password_hash: passwordHash,
                display_name: displayName || username || email?.split('@')[0] || 'User',
                role: 'user',
            }).returning(['id', 'email', 'username', 'display_name', 'role', 'created_at']);

            return { user: this.sanitizeUser(user), tokens: await this.generateTokens(user) };
        } catch (err) {
            if (err.code === '23505') { // Unique violation
                throw new Error('Email or username already taken');
            }
            throw err;
        }
    }

    /**
     * Login with email/username + password.
     */
    async login({ email, username, password, deviceInfo, ipAddress }) {
        const user = await db('users')
            .where(function () {
                if (email) this.where('email', email);
                if (username) this.orWhere('username', username);
            })
            .where('is_active', true)
            .first();

        if (!user) throw new Error('Invalid credentials');

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) throw new Error('Invalid credentials');

        // Update login info
        await db('users').where('id', user.id).update({
            last_login: new Date(),
            login_count: db.raw('login_count + 1'),
        });

        const tokens = await this.generateTokens(user, deviceInfo, ipAddress);
        return { user: this.sanitizeUser(user), tokens };
    }

    /**
     * Refresh access token using refresh token.
     */
    async refreshToken(refreshToken) {
        let payload;
        try {
            payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        } catch {
            throw new Error('Invalid refresh token');
        }

        // Check if token is revoked
        const stored = await db('refresh_tokens')
            .where({ token: refreshToken, is_revoked: false })
            .where('expires_at', '>', new Date())
            .first();

        if (!stored) throw new Error('Refresh token revoked or expired');

        const user = await db('users').where({ id: payload.sub, is_active: true }).first();
        if (!user) throw new Error('User not found');

        const tokens = await this.generateTokens(user);
        // Revoke old refresh token (rotation)
        await db('refresh_tokens').where('id', stored.id).update({ is_revoked: true });

        return { user: this.sanitizeUser(user), tokens };
    }

    /**
     * Generate access + refresh tokens.
     */
    async generateTokens(user, deviceInfo, ipAddress) {
        const accessPayload = { sub: user.id, role: user.role, type: 'access' };
        const refreshPayload = { sub: user.id, type: 'refresh' };

        const accessToken = jwt.sign(accessPayload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
        const refreshToken = jwt.sign(refreshPayload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });

        // Store refresh token
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await db('refresh_tokens').insert({
            user_id: user.id,
            token: refreshToken,
            device_info: deviceInfo || null,
            ip_address: ipAddress || null,
            expires_at: expiresAt,
        });

        return {
            accessToken,
            refreshToken,
            expiresIn: 900, // 15 minutes in seconds
            tokenType: 'Bearer',
        };
    }

    /**
     * Revoke all refresh tokens for a user (logout everywhere).
     */
    async revokeAllTokens(userId) {
        await db('refresh_tokens').where({ user_id: userId }).update({ is_revoked: true });
    }

    /**
     * Link a device to a user account (for favorites sync).
     */
    async linkDevice(userId, deviceId) {
        await db('devices').where('device_id', deviceId).update({ user_id: userId }).onConflict('device_id').merge();
        // Migrate device favorites to user favorites
        await db.raw(`
            INSERT INTO favorites (user_id, channel_id, created_at)
            SELECT ?, channel_id, CURRENT_TIMESTAMP
            FROM favorites WHERE device_id = (SELECT id FROM devices WHERE device_id = ?)
            AND NOT EXISTS (
                SELECT 1 FROM favorites f2 WHERE f2.user_id = ? AND f2.channel_id = favorites.channel_id
            )
        `, [userId, deviceId, userId]);
    }

    /**
     * Verify and decode an access token.
     */
    verifyAccessToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch {
            return null;
        }
    }

    sanitizeUser(user) {
        const { password_hash, ...safe } = user;
        return safe;
    }
}

module.exports = new AuthService();
