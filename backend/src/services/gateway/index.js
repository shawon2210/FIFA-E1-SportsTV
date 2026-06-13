// ============================================================
// A1TV v4 — Stream Gateway Service
// Regional Routing, Edge Affinity, Origin Balancing,
// Stream Token Validation, Geo Enforcement
//
// Architecture:
//   Cloudflare / CDN Edge
//         ↓
//   Stream Gateway (this service)
//         ↓
//   Regional Origin Pools
//         ↓
//   Backend API / Stream Proxy
// ============================================================

const db = require('../../config/database');
const cache = require('../cache');
const config = require('../../config');

// ── Region Configuration ────────────────────────────────────
const REGIONS = {
  'ap-southeast-1': {
    name: 'Singapore',
    priority: 1,
    origins: [
      { host: 'origin-sg.a1tv.internal', weight: 100, healthy: true },
    ],
    edgeNodes: ['edge-sg-1.a1tv.com', 'edge-sg-2.a1tv.com'],
    countries: ['SG', 'MY', 'ID', 'TH', 'VN', 'PH', 'MM', 'KH', 'LA', 'BN', 'TL'],
  },
  'eu-central-1': {
    name: 'Frankfurt',
    priority: 2,
    origins: [
      { host: 'origin-de.a1tv.internal', weight: 100, healthy: true },
    ],
    edgeNodes: ['edge-de-1.a1tv.com', 'edge-de-2.a1tv.com'],
    countries: ['DE', 'FR', 'NL', 'BE', 'AT', 'CH', 'PL', 'CZ', 'HU', 'RO', 'BG', 'HR', 'SK', 'SI', 'DK', 'SE', 'NO', 'FI', 'IE', 'PT', 'ES', 'IT', 'GR', 'GB'],
  },
  'us-east-1': {
    name: 'Virginia',
    priority: 3,
    origins: [
      { host: 'origin-us.a1tv.internal', weight: 70, healthy: true },
      { host: 'origin-us-west.a1tv.internal', weight: 30, healthy: true },
    ],
    edgeNodes: ['edge-us-1.a1tv.com', 'edge-us-2.a1tv.com', 'edge-us-3.a1tv.com'],
    countries: ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'UY', 'PY', 'BO'],
  },
  'ap-south-1': {
    name: 'Mumbai',
    priority: 4,
    origins: [
      { host: 'origin-in.a1tv.internal', weight: 100, healthy: true },
    ],
    edgeNodes: ['edge-in-1.a1tv.com'],
    countries: ['IN', 'BD', 'PK', 'LK', 'NP', 'BT', 'MV', 'AF'],
  },
  'ap-southeast-2': {
    name: 'Sydney',
    priority: 5,
    origins: [
      { host: 'origin-au.a1tv.internal', weight: 100, healthy: true },
    ],
    edgeNodes: ['edge-au-1.a1tv.com'],
    countries: ['AU', 'NZ', 'FJ', 'PG', 'SB', 'VU'],
  },
};

// ── Geo IP to Country Code (simplified mapping) ────────────
// In production, use MaxMind GeoIP or Cloudflare CF-IPCountry header
function countryFromIP(ip) {
  // Simplified: check cache first
  return null; // Will be resolved by CDN header
}

function regionFromCountry(countryCode) {
  if (!countryCode) return 'us-east-1'; // Default
  const cc = countryCode.toUpperCase();
  for (const [regionId, region] of Object.entries(REGIONS)) {
    if (region.countries.includes(cc)) return regionId;
  }
  return 'us-east-1'; // Default fallback
}

// ── Origin Health Tracker ───────────────────────────────────
class OriginHealth {
  constructor() {
    this.health = {};
    for (const regionId of Object.keys(REGIONS)) {
      this.health[regionId] = {};
      for (const origin of REGIONS[regionId].origins) {
        this.health[regionId][origin.host] = {
          healthy: true,
          lastCheck: Date.now(),
          latency: 0,
          failures: 0,
        };
      }
    }
  }

  markUnhealthy(regionId, host) {
    if (this.health[regionId]?.[host]) {
      this.health[regionId][host].healthy = false;
      this.health[regionId][host].lastCheck = Date.now();
      this.health[regionId][host].failures++;
    }
  }

  markHealthy(regionId, host, latency) {
    if (this.health[regionId]?.[host]) {
      this.health[regionId][host].healthy = true;
      this.health[regionId][host].lastCheck = Date.now();
      this.health[regionId][host].latency = latency;
      this.health[regionId][host].failures = 0;
    }
  }

  getHealthyOrigins(regionId) {
    const region = REGIONS[regionId];
    if (!region) return [];

    return region.origins.filter(o => {
      const h = this.health[regionId]?.[o.host];
      return h?.healthy !== false;
    });
  }

  getStatus() {
    return this.health;
  }
}

const originHealth = new OriginHealth();

// ── Weighted Origin Selection ───────────────────────────────
function selectOrigin(regionId) {
  const healthy = originHealth.getHealthyOrigins(regionId);
  if (healthy.length === 0) {
    // All origins unhealthy — pick least-bad one
    const region = REGIONS[regionId];
    return region?.origins[0] || null;
  }

  const totalWeight = healthy.reduce((s, o) => s + o.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const origin of healthy) {
    rand -= origin.weight;
    if (rand <= 0) return origin;
  }
  return healthy[healthy.length - 1];
}

// ── Edge Affinity (sticky routing) ──────────────────────────
class EdgeAffinity {
  constructor() {
    this.affinities = new Map(); // userId -> { regionId, edgeNode, expires }
    this.TTL_MS = 300000; // 5 minutes
  }

  get(userId) {
    const entry = this.affinities.get(userId);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.affinities.delete(userId);
      return null;
    }
    return entry;
  }

  set(userId, regionId, edgeNode) {
    this.affinities.set(userId, {
      regionId,
      edgeNode,
      expires: Date.now() + this.TTL_MS,
    });
  }

  // Cleanup expired entries periodically
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.affinities) {
      if (now > entry.expires) this.affinities.delete(key);
    }
  }
}

const edgeAffinity = new EdgeAffinity();

// Cleanup every 60s
setInterval(() => edgeAffinity.cleanup(), 60000);

// ── Stream Token Validation ─────────────────────────────────
const crypto = require('crypto');
const STREAM_TOKEN_SECRET = process.env.STREAM_TOKEN_SECRET || 'a1tv_stream_token_change_me';
const STREAM_TOKEN_TTL = 300; // 5 minutes

function generateStreamToken(channelId, userId, regionId) {
  const expires = Math.floor(Date.now() / 1000) + STREAM_TOKEN_TTL;
  const payload = `${channelId}:${userId}:${regionId}:${expires}`;
  const signature = crypto.createHmac('sha256', STREAM_TOKEN_SECRET).update(payload).digest('hex');
  return {
    token: Buffer.from(JSON.stringify({ channelId, userId, regionId, expires, sig: signature })).toString('base64url'),
    expires,
  };
}

function validateStreamToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString());
    const { channelId, userId, regionId, expires, sig } = decoded;

    if (Date.now() / 1000 > expires) return { valid: false, reason: 'expired' };

    const payload = `${channelId}:${userId}:${regionId}:${expires}`;
    const expected = crypto.createHmac('sha256', STREAM_TOKEN_SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { valid: false, reason: 'invalid_signature' };
    }

    return { valid: true, channelId, userId, regionId };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}

// ── Geo Enforcement ─────────────────────────────────────────
// Some streams are geo-restricted (e.g., sports broadcasting rights)
async function checkGeoRestriction(channelId, countryCode) {
  const cacheKey = `geo:restriction:${channelId}`;
  let restrictions = await cache.get(cacheKey);

  if (!restrictions) {
    const channel = await db('channels')
      .where({ id: channelId })
      .select('metadata')
      .first();

    restrictions = channel?.metadata?.geoRestrictions || null;
    if (restrictions) {
      await cache.set(cacheKey, restrictions, 300);
    }
  }

  if (!restrictions) return { allowed: true };

  const { allowed = [], blocked = [] } = restrictions;

  if (blocked.includes(countryCode)) return { allowed: false, reason: 'blocked' };
  if (allowed.length > 0 && !allowed.includes(countryCode)) return { allowed: false, reason: 'not_allowed' };

  return { allowed: true };
}

// ── Main Gateway Router ─────────────────────────────────────
class StreamGateway {
  /**
   * Route a stream request to the optimal origin.
   * Considers: user location, edge affinity, origin health, geo restrictions.
   */
  async route(params) {
    const { channelId, userId, countryCode, clientIP } = params;

    // 1. Determine region from country/ASN
    let regionId = regionFromCountry(countryCode);

    // 2. Check edge affinity (sticky routing)
    const affinity = userId ? edgeAffinity.get(userId) : null;
    if (affinity && REGIONS[affinity.regionId]) {
      // Only reuse affinity if origin is still healthy
      const healthy = originHealth.getHealthyOrigins(affinity.regionId);
      if (healthy.length > 0) {
        regionId = affinity.regionId;
      }
    }

    // 3. Check geo restrictions
    const geoCheck = await checkGeoRestriction(channelId, countryCode);
    if (!geoCheck.allowed) {
      return {
        success: false,
        error: 'geo_blocked',
        reason: geoCheck.reason,
        region: regionId,
      };
    }

    // 4. Select best origin
    const origin = selectOrigin(regionId);
    if (!origin) {
      return { success: false, error: 'no_healthy_origins', region: regionId };
    }

    // 5. Generate signed stream token
    const streamToken = generateStreamToken(channelId, userId, regionId);

    // 6. Set edge affinity for next request
    if (userId) {
      const region = REGIONS[regionId];
      const edgeNode = region.edgeNodes[Math.floor(Math.random() * region.edgeNodes.length)];
      edgeAffinity.set(userId, regionId, edgeNode);
    }

    // 7. Build response
    return {
      success: true,
      region: regionId,
      regionName: REGIONS[regionId].name,
      origin: origin.host,
      edgeNode: REGIONS[regionId].edgeNodes[0],
      streamToken: streamToken.token,
      tokenExpires: streamToken.expires,
      urls: {
        hls: `https://${origin.host}/stream/${channelId}/playlist.m3u8?token=${streamToken.token}`,
        dash: `https://${origin.host}/stream/${channelId}/manifest.mpd?token=${streamToken.token}`,
        ws: `wss://${origin.host}/ws/stream/${channelId}?token=${streamToken.token}`,
      },
    };
  }

  /**
   * Get current gateway status across all regions.
   */
  getStatus() {
    const status = {
      regions: {},
      totalHealthyOrigins: 0,
      totalOrigins: 0,
    };

    for (const [regionId, region] of Object.entries(REGIONS)) {
      const origins = originHealth.getHealthyOrigins(regionId);
      status.regions[regionId] = {
        name: region.name,
        healthyOrigins: origins.length,
        totalOrigins: region.origins.length,
        edgeNodes: region.edgeNodes.length,
      };
      status.totalHealthyOrigins += origins.length;
      status.totalOrigins += region.origins.length;
    }

    return status;
  }
}

module.exports = {
  StreamGateway: new StreamGateway(),
  StreamGatewayClass: StreamGateway,
  originHealth,
  edgeAffinity,
  REGIONS,
  validateStreamToken,
  generateStreamToken,
  checkGeoRestriction,
  regionFromCountry,
  selectOrigin,
};
