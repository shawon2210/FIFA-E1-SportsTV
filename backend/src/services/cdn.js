// A1TV v2 - Video CDN Layer
// Edge nodes, geo-routing, regional failover

const db = require('../config/database');
const cache = require('../services/cache');

class CDNLayers {
    constructor() {
        this.regions = {
            'NA': { name: 'North America', servers: ['us-east-1', 'us-west-1', 'ca-central-1'], countries: ['US', 'CA', 'MX'] },
            'EU': { name: 'Europe', servers: ['eu-west-1', 'eu-central-1', 'eu-north-1'], countries: ['GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'PL', 'AT', 'CH', 'BE', 'PT', 'IE'] },
            'AS': { name: 'Asia', servers: ['ap-southeast-1', 'ap-northeast-1', 'ap-south-1'], countries: ['JP', 'KR', 'CN', 'IN', 'TH', 'VN', 'ID', 'MY', 'SG', 'PH', 'PK', 'BD'] },
            'SA': { name: 'South America', servers: ['sa-east-1'], countries: ['BR', 'AR', 'CL', 'CO', 'PE'] },
            'AF': { name: 'Africa', servers: ['af-south-1'], countries: ['ZA', 'NG', 'KE', 'GH', 'EG'] },
            'OC': { name: 'Oceania', servers: ['ap-southeast-2'], countries: ['AU', 'NZ'] },
            'ME': { name: 'Middle East', servers: ['me-south-1'], countries: ['AE', 'SA', 'TR', 'IL'] },
        };
    }

    /**
     * Get the best edge region for a user based on their country.
     */
    getEdgeRegion(countryCode) {
        for (const [region, config] of Object.entries(this.regions)) {
            if (config.countries.includes(countryCode)) {
                return { region, ...config };
            }
        }
        return { region: 'EU', ...this.regions['EU'] }; // Default to EU
    }

    /**
     * Get the best edge server for a user.
     * Considers: region, server load, latency.
     */
    async getBestEdgeServer(countryCode) {
        const cacheKey = 'edge:best:' + countryCode;
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const region = this.getEdgeRegion(countryCode);

        // Get server health from cache
        let bestServer = region.servers[0];
        let bestScore = -1;

        for (const server of region.servers) {
            const health = await cache.get('edge:health:' + server);
            const score = health ? (100 - (health.load || 0)) : 50;
            if (score > bestScore) {
                bestScore = score;
                bestServer = server;
            }
        }

        const result = {
            server: bestServer,
            region: region.region,
            regionName: region.name,
            edgeUrl: 'https://' + bestServer + '.edge.a1tv.com',
        };

        await cache.set(cacheKey, result, 60);
        return result;
    }

    /**
     * Generate a CDN-optimized stream URL.
     * Routes through the nearest edge server.
     */
    async getCDNStreamUrl(channelId, streamId, countryCode, userId) {
        const edge = await this.getBestEdgeServer(countryCode);

        // Generate signed URL for edge server
        const crypto = require('crypto');
        const expires = Math.floor(Date.now() / 1000) + 300; // 5 min TTL
        const data = channelId + ':' + streamId + ':' + userId + ':' + expires;
        const signature = crypto.createHmac('sha256', process.env.CDN_SIGNING_SECRET || 'cdn_secret').update(data).digest('hex');

        return {
            edgeUrl: edge.edgeUrl + '/stream/' + channelId + '/' + streamId,
            token: signature,
            expires,
            edge: edge.server,
            region: edge.region,
        };
    }

    /**
     * Regional failover: Get backup edge servers.
     */
    async getRegionalFailover(countryCode) {
        const primary = this.getEdgeRegion(countryCode);
        const allRegions = Object.entries(this.regions);

        // Sort regions by geographic proximity (simplified)
        const sorted = allRegions.sort((a, b) => {
            if (a[0] === primary.region) return -1;
            if (b[0] === primary.region) return 1;
            return 0;
        });

        const failover = [];
        for (const [region, config] of sorted.slice(0, 3)) {
            if (region !== primary.region) {
                failover.push({
                    region,
                    name: config.name,
                    servers: config.servers,
                    edgeUrl: 'https://' + config.servers[0] + '.edge.a1tv.com',
                });
            }
        }

        return failover;
    }

    /**
     * Report edge server health (called by edge nodes).
     */
    async reportEdgeHealth(serverId, metrics) {
        await cache.set('edge:health:' + serverId, {
            load: metrics.load || 0,
            bandwidth: metrics.bandwidth || 0,
            connections: metrics.connections || 0,
            latency: metrics.latency || 0,
            lastReport: Date.now(),
        }, 30);
    }

    /**
     * Get CDN statistics.
     */
    async getCDNStats() {
        const stats = { regions: {}, totalConnections: 0 };

        for (const [region, config] of Object.entries(this.regions)) {
            stats.regions[region] = {
                name: config.name,
                servers: {},
            };

            for (const server of config.servers) {
                const health = await cache.get('edge:health:' + server);
                stats.regions[region].servers[server] = health || { load: 0, connections: 0 };
                stats.totalConnections += health?.connections || 0;
            }
        }

        return stats;
    }
}

module.exports = new CDNLayers();
