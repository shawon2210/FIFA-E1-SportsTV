// A1TV v2 - Multi-Tenant Middleware & Routes
// Organization isolation, white-label support, tenant-aware queries

const { Router } = require('express');
const db = require('../config/database');
const { authenticate, validate, body, query, param } = require('../middleware/auth');

// ============================================================
// Middleware: Resolve tenant from domain or header
// ============================================================
async function resolveTenant(req, res, next) {
    // Resolve organization from custom domain or header
    const host = req.headers.host || '';
    const orgHeader = req.headers['x-organization-id'] || req.query.organization_id;

    let org = null;

    if (orgHeader) {
        org = await db('organizations').where({ id: orgHeader, status: 'active' }).first();
    } else if (host) {
        // Match by custom domain
        org = await db('organizations').where({ domain: host, status: 'active' }).first();
        // Also match by slug (e.g., brand-a.a1tv.com)
        if (!org) {
            const slug = host.split('.')[0];
            if (slug && slug !== 'www' && slug !== 'api') {
                org = await db('organizations').where({ slug, status: 'active' }).first();
            }
        }
    }

    req.organization = org || null;
    req.organizationId = org ? org.id : null;
    next();
}

// ============================================================
// Middleware: Require organization membership
// ============================================================
async function requireOrgMember(req, res, next) {
    if (!req.organization) {
        return res.status(404).json({ success: false, error: 'Organization not found' });
    }
    if (!req.userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const membership = await db('organization_users')
        .where({ organization_id: req.organizationId, user_id: req.userId, is_active: true })
        .first();
    if (!membership) {
        return res.status(403).json({ success: false, error: 'Not a member of this organization' });
    }
    req.orgRole = membership.role;
    req.orgPermissions = membership.permissions || {};
    next();
}

function requireOrgRole(...roles) {
    return function(req, res, next) {
        if (!req.orgRole || !roles.includes(req.orgRole)) {
            return res.status(403).json({ success: false, error: 'Insufficient organization permissions' });
        }
        next();
    };
}

// ============================================================
// Router: Organization Management
// ============================================================
const router = Router();
router.use(resolveTenant);

// POST /api/v1/organizations - Create organization
router.post('/', authenticate, [
    body('name').isString().trim().isLength({ min: 2, max: 255 }),
    body('slug').optional().isAlphanumeric().isLength({ min: 2, max: 100 }),
    body('domain').optional().isURL(),
    validate,
], async (req, res) => {
    try {
        const { name, slug, domain } = req.body;
        const orgSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 100);

        const [org] = await db('organizations').insert({
            name, slug: orgSlug, domain: domain || null, plan: 'free'
        }).returning('*');

        // Add creator as owner
        await db('organization_users').insert({
            organization_id: org.id,
            user_id: req.userId,
            role: 'owner',
            permissions: { all: true }
        });

        res.status(201).json({ success: true, data: org });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ success: false, error: 'Organization slug or domain already taken' });
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/v1/organizations/my - List user's organizations
router.get('/my', authenticate, async (req, res) => {
    try {
        const orgs = await db('organizations')
            .select('organizations.*', 'organization_users.role')
            .join('organization_users', 'organizations.id', 'organization_users.organization_id')
            .where({ 'organization_users.user_id': req.userId, 'organization_users.is_active': true })
            .orderBy('organizations.created_at', 'desc');
        res.json({ success: true, data: orgs });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/v1/organizations/:id - Get organization details
router.get('/:id', authenticate, requireOrgMember, async (req, res) => {
    try {
        const stats = await db('v_organization_stats').where('id', req.params.id).first();
        res.json({ success: true, data: { ...req.organization, stats } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/v1/organizations/:id - Update organization (owner/admin)
router.put('/:id', authenticate, requireOrgMember, requireOrgRole('owner', 'admin'), [
    body('name').optional().isString().trim(),
    body('domain').optional().isURL(),
    body('branding').optional().isObject(),
    validate,
], async (req, res) => {
    try {
        const update = {};
        if (req.body.name) update.name = req.body.name;
        if (req.body.domain) update.domain = req.body.domain;
        if (req.body.branding) update.branding = req.body.branding;
        update.updated_at = new Date();

        const [org] = await db('organizations').where('id', req.params.id).update(update).returning('*');
        res.json({ success: true, data: org });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/v1/organizations/:id/members - Invite member
router.post('/:id/members', authenticate, requireOrgMember, requireOrgRole('owner', 'admin'), [
    body('email').isEmail(),
    body('role').optional().isIn(['admin', 'editor', 'member', 'viewer']),
    validate,
], async (req, res) => {
    try {
        const { email, role = 'member' } = req.body;
        const user = await db('users').where('email', email).first();
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        await db('organization_users').insert({
            organization_id: req.params.id,
            user_id: user.id,
            role
        }).onConflict(['organization_id', 'user_id']).merge();

        res.json({ success: true, data: { message: 'Member added', userId: user.id, role } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/v1/organizations/:id/channels - Get tenant channel lineup
router.get('/:id/channels', authenticate, requireOrgMember, [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        // Get organization's visible channels with custom overrides
        const channels = await db('organization_channels')
            .select(
                'channels.id',
                db.raw('COALESCE(organization_channels.custom_name, channels.name) as name'),
                db.raw('COALESCE(organization_channels.custom_logo, channels.logo_url) as logo_url'),
                'channels.quality',
                'channels.view_count',
                'organization_channels.sort_order',
                'organization_channels.categories'
            )
            .join('channels', 'organization_channels.channel_id', 'channels.id')
            .where({ 'organization_channels.organization_id': req.params.id, 'organization_channels.is_visible': true })
            .where('channels.is_active', true)
            .orderBy('organization_channels.sort_order', 'asc')
            .offset(offset)
            .limit(limit);

        const { count } = await db('organization_channels')
            .where({ organization_id: req.params.id, is_visible: true })
            .count('* as count').first();

        res.json({
            success: true,
            data: channels,
            pagination: { page, limit, total: parseInt(count), pages: Math.ceil(parseInt(count) / limit) }
        });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/v1/organizations/:id/channels - Add channel to lineup
router.post('/:id/channels', authenticate, requireOrgMember, requireOrgRole('owner', 'admin', 'editor'), [
    body('channel_id').isUUID(),
    body('custom_name').optional().isString(),
    body('custom_logo').optional().isURL(),
    validate,
], async (req, res) => {
    try {
        const { channel_id, custom_name, custom_logo } = req.body;
        await db('organization_channels').insert({
            organization_id: req.params.id,
            channel_id,
            custom_name: custom_name || null,
            custom_logo: custom_logo || null,
            added_by: req.userId
        }).onConflict(['organization_id', 'channel_id']).merge();

        res.json({ success: true, data: { message: 'Channel added to lineup' } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/v1/organizations/:id/stats - Organization dashboard stats
router.get('/:id/stats', authenticate, requireOrgMember, async (req, res) => {
    try {
        const stats = await db('v_organization_stats').where('id', req.params.id).first();
        const topChannels = await db('channel_views')
            .select('channels.name', db.raw('COUNT(*) as views'))
            .join('channels', 'channel_views.channel_id', 'channels.id')
            .where({ 'channel_views.organization_id': req.params.id })
            .where('channel_views.viewed_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
            .groupBy('channels.name')
            .orderByRaw('COUNT(*) DESC')
            .limit(10);

        res.json({ success: true, data: { ...stats, topChannels } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = { router, resolveTenant, requireOrgMember, requireOrgRole };
