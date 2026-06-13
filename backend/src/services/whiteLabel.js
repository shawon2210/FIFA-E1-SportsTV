// ============================================================
// A1TV v4 — White Label SaaS Service
// Tenant theming, branding, domain management, analytics.
// ============================================================

const db = require('../config/database');
const cache = require('./cache');

class WhiteLabelService {
  /**
   * Get tenant theme configuration.
   */
  async getTheme(tenantId) {
    const cacheKey = `whitelabel:theme:${tenantId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const theme = await db('tenant_themes')
      .where({ tenant_id: tenantId, is_active: true })
      .first();

    if (!theme) {
      // Return default theme
      return this.getDefaultTheme(tenantId);
    }

    await cache.set(cacheKey, theme, 300);
    return theme;
  }

  /**
   * Update tenant theme.
   */
  async updateTheme(tenantId, updates) {
    const allowed = [
      'logo_url', 'logo_dark_url', 'favicon_url',
      'primary_color', 'secondary_color', 'accent_color',
      'background_color', 'text_color',
      'font_family', 'heading_font',
      'layout_type', 'header_style', 'custom_css',
    ];

    const data = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) data[key] = updates[key];
    }
    data.updated_at = new Date();

    await db('tenant_themes')
      .insert({ tenant_id: tenantId, ...data, is_active: true })
      .onConflict('tenant_id')
      .merge(data);

    await cache.del(`whitelabel:theme:${tenantId}`);
    return this.getTheme(tenantId);
  }

  /**
   * Get default theme for a tenant.
   */
  async getDefaultTheme(tenantId) {
    return {
      tenant_id: tenantId,
      logo_url: '/assets/logo.svg',
      primary_color: '#1a73e8',
      secondary_color: '#34a853',
      accent_color: '#fbbc04',
      background_color: '#ffffff',
      text_color: '#202124',
      font_family: 'Inter, system-ui, sans-serif',
      layout_type: 'default',
      header_style: 'standard',
      custom_css: '',
    };
  }

  /**
   * Generate CSS variables from theme.
   */
  generateCssVariables(theme) {
    return `
:root {
  --a1tv-primary: ${theme.primary_color};
  --a1tv-secondary: ${theme.secondary_color};
  --a1tv-accent: ${theme.accent_color};
  --a1tv-bg: ${theme.background_color};
  --a1tv-text: ${theme.text_color};
  --a1tv-font: ${theme.font_family};
  ${theme.heading_font ? `--a1tv-heading-font: ${theme.heading_font};` : ''}
}
${theme.custom_css || ''}
    `.trim();
  }

  // ── Custom Domains ─────────────────────────────────────────
  async getDomain(tenantId) {
    return db('tenant_domains')
      .where({ tenant_id: tenantId, status: 'active' })
      .first();
  }

  async registerDomain(tenantId, domain) {
    const verificationToken = require('crypto').randomBytes(32).toString('hex');

    await db('tenant_domains').insert({
      tenant_id: tenantId,
      domain: domain.toLowerCase(),
      verification_token: verificationToken,
      cname_target: 'cname.a1tv.com',
      status: 'pending',
    });

    return {
      domain,
      verificationToken,
      cnameTarget: 'cname.a1tv.com',
      instructions: `Add a CNAME record: ${domain} → cname.a1tv.com`,
    };
  }

  async verifyDomain(tenantId, domain) {
    // In production, this would check DNS resolution
    await db('tenant_domains')
      .where({ tenant_id: tenantId, domain: domain.toLowerCase() })
      .update({ is_verified: true, status: 'active', updated_at: new Date() });

    return { verified: true, domain };
  }

  // ── Tenant Channel Collections ─────────────────────────────
  async getTenantChannels(tenantId) {
    const cacheKey = `whitelabel:channels:${tenantId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const channels = await db('tenant_channels as tc')
      .join('channels as c', 'tc.channel_id', 'c.id')
      .where({ 'tc.tenant_id': tenantId, 'tc.is_visible': true })
      .orderBy('tc.sort_order')
      .select(
        'c.*',
        'tc.custom_name',
        'tc.custom_logo_url',
        'tc.sort_order'
      );

    await cache.set(cacheKey, channels, 120);
    return channels;
  }

  async addChannelToTenant(tenantId, channelId, options = {}) {
    await db('tenant_channels')
      .insert({
        tenant_id: tenantId,
        channel_id: channelId,
        custom_name: options.customName || null,
        custom_logo_url: options.customLogoUrl || null,
        sort_order: options.sortOrder || 0,
      })
      .onConflict(['tenant_id', 'channel_id'])
      .merge();

    await cache.del(`whitelabel:channels:${tenantId}`);
  }

  async removeChannelFromTenant(tenantId, channelId) {
    await db('tenant_channels')
      .where({ tenant_id: tenantId, channel_id: channelId })
      .update({ is_visible: false });

    await cache.del(`whitelabel:channels:${tenantId}`);
  }

  // ── Tenant Analytics ───────────────────────────────────────
  async recordAnalytics(tenantId, data) {
    const today = new Date().toISOString().split('T')[0];

    await db('tenant_analytics')
      .insert({
        tenant_id: tenantId,
        date: today,
        total_views: data.totalViews || 0,
        unique_viewers: data.uniqueViewers || 0,
        avg_watch_duration: data.avgWatchDuration || 0,
        total_watch_time: data.totalWatchTime || 0,
        peak_concurrent: data.peakConcurrent || 0,
        channel_switches: data.channelSwitches || 0,
        top_channels: JSON.stringify(data.topChannels || []),
        top_categories: JSON.stringify(data.topCategories || []),
        top_countries: JSON.stringify(data.topCountries || []),
        devices: JSON.stringify(data.devices || {}),
        buffering_events: data.bufferingEvents || 0,
        error_rate: data.errorRate || 0,
      })
      .onConflict(['tenant_id', 'date'])
      .merge();
  }

  async getAnalytics(tenantId, days = 30) {
    const cacheKey = `whitelabel:analytics:${tenantId}:${days}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const since = new Date(Date.now() - days * 86400000);

    const analytics = await db('tenant_analytics')
      .where({ tenant_id: tenantId })
      .where('date', '>=', since.toISOString().split('T')[0])
      .orderBy('date', 'desc');

    // Aggregate
    const summary = {
      totalViews: analytics.reduce((s, a) => s + (a.total_views || 0), 0),
      uniqueViewers: analytics.reduce((s, a) => s + (a.unique_viewers || 0), 0),
      avgWatchDuration: analytics.length > 0
        ? Math.round(analytics.reduce((s, a) => s + (a.avg_watch_duration || 0), 0) / analytics.length)
        : 0,
      peakConcurrent: Math.max(...analytics.map(a => a.peak_concurrent || 0), 0),
      totalBufferingEvents: analytics.reduce((s, a) => s + (a.buffering_events || 0), 0),
      daily: analytics,
    };

    await cache.set(cacheKey, summary, 300);
    return summary;
  }

  // ── Tenant Usage Tracking ──────────────────────────────────
  async recordUsage(tenantId, metric, value) {
    await db('tenant_usage').insert({
      tenant_id: tenantId,
      metric,
      value,
    });
  }

  async getUsage(tenantId, metric, hours = 24) {
    const since = new Date(Date.now() - hours * 3600000);

    const result = await db('tenant_usage')
      .where({ tenant_id: tenantId, metric })
      .where('recorded_at', '>=', since)
      .sum('value as total')
      .first();

    return parseInt(result?.total) || 0;
  }

  /**
   * Check if tenant is within billing limits.
   */
  async checkLimits(tenantId) {
    const billing = await db('tenant_billing')
      .where({ tenant_id: tenantId })
      .first();

    if (!billing) return { withinLimits: true };

    const [viewerUsage, channelUsage] = await Promise.all([
      this.getUsage(tenantId, 'viewers', 24),
      db('tenant_channels').where({ tenant_id: tenantId, is_visible: true }).count('* as count').first(),
    ]);

    const channelCount = parseInt(channelUsage?.count) || 0;

    return {
      withinLimits: viewerUsage <= billing.max_viewers && channelCount <= billing.max_channels,
      viewers: { current: viewerUsage, limit: billing.max_viewers },
      channels: { current: channelCount, limit: billing.max_channels },
      overage: {
        viewers: Math.max(0, viewerUsage - billing.max_viewers),
        channels: Math.max(0, channelCount - billing.max_channels),
      },
    };
  }
}

module.exports = {
  WhiteLabelService,
  whiteLabel: new WhiteLabelService(),
};
