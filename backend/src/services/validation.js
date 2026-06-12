// ============================================================
// A1TV v2 — Stream Validation Service
// Deep validation: HTTP, HLS manifest, segments, geo-block, redirects
// ============================================================

const axios = require('axios');
const db = require('../config/database');
const config = require('../config');

const STATUS = { ONLINE: 'online', OFFLINE: 'offline', GEO_BLOCKED: 'geo_blocked', SLOW: 'slow', INVALID: 'invalid', UNKNOWN: 'unknown' };

class ValidationService {
    constructor() {
        this.timeout = config.healthCheck.timeout || 10000;
    }

    /**
     * Full validation pipeline for a single stream.
     * Returns a validation result object.
     */
    async validate(stream) {
        const result = {
            streamId: stream.id,
            channelId: stream.channel_id,
            url: stream.url,
            status: STATUS.UNKNOWN,
            httpStatus: null,
            contentType: null,
            responseTime: null,
            isRedirect: false,
            redirectUrl: null,
            manifestValid: false,
            segmentsFound: false,
            geoBlocked: false,
            error: null,
        };

        const startTime = Date.now();

        try {
            const response = await axios.get(stream.url, {
                timeout: this.timeout,
                responseType: 'text',
                headers: {
                    'Accept': 'application/vnd.apple.mpegurl, audio/mpegurl, */*',
                    'User-Agent': 'A1TV-Validator/2.0',
                },
                maxContentLength: 128 * 1024,
                validateStatus: () => true, // Don't throw on non-2xx
                maxRedirects: 5,
            });

            result.responseTime = Date.now() - startTime;
            result.httpStatus = response.status;
            result.contentType = response.headers['content-type'] || null;

            // Check for redirects
            if (response.request?.res?.responseUrl && response.request.res.responseUrl !== stream.url) {
                result.isRedirect = true;
                result.redirectUrl = response.request.res.responseUrl;
            }

            // Check for geo-blocking patterns
            if (this.detectGeoBlock(response)) {
                result.status = STATUS.GEO_BLOCKED;
                result.geoBlocked = true;
                return result;
            }

            // Check HTTP status
            if (response.status !== 200) {
                result.status = STATUS.OFFLINE;
                result.error = `HTTP ${response.status}`;
                return result;
            }

            // Check response time
            if (result.responseTime > 8000) {
                result.status = STATUS.SLOW;
                result.error = `Slow response: ${result.responseTime}ms`;
                // Still check manifest — slow but valid
            }

            // Validate HLS manifest
            const data = (response.data || '').trim();
            if (!data.startsWith('#EXTM3U')) {
                result.status = STATUS.INVALID;
                result.error = 'Response is not a valid M3U8 playlist';
                return result;
            }

            result.manifestValid = true;

            // Check for media content
            const hasExtInf = data.includes('#EXTINF:');
            const hasStreamInf = data.includes('#EXT-X-STREAM-INF:');
            const hasMediaSegments = /\.(ts|m4s|mp4|aac|ac3|webm|mp3)(\?|$)/m.test(data);
            const hasEndlist = data.includes('#EXT-X-ENDLIST');

            result.segmentsFound = hasExtInf || hasStreamInf || hasMediaSegments;

            if (!result.segmentsFound && !hasStreamInf) {
                result.status = STATUS.INVALID;
                result.error = 'Playlist has no media entries';
                return result;
            }

            // If not marked slow, it's online
            if (result.status !== STATUS.SLOW) {
                result.status = STATUS.ONLINE;
            }

        } catch (err) {
            result.responseTime = Date.now() - startTime;

            if (err.code === 'ECONNABORTED') {
                result.status = STATUS.SLOW;
                result.error = 'Request timeout';
            } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
                result.status = STATUS.OFFLINE;
                result.error = err.code;
            } else {
                result.status = STATUS.OFFLINE;
                result.error = err.message?.substring(0, 200);
            }
        }

        return result;
    }

    /**
     * Detect geo-blocking patterns in response.
     */
    detectGeoBlock(response) {
        const data = (response.data || '').toLowerCase();
        const headers = response.headers || {};

        // Common geo-block indicators
        const geoPatterns = [
            'geo restricted', 'geoblocked', 'geo-blocked', 'not available in your region',
            'content unavailable', '403 forbidden', 'access denied',
            'this content is not available', 'regional restriction',
            'blocked in your country', 'outside the united states',
        ];

        for (const pattern of geoPatterns) {
            if (data.includes(pattern)) return true;
        }

        // Check for Cloudflare/Akamai geo-block headers
        if (cfRay = headers['cf-ray']) {
            if (data.includes('403') && data.includes('cloudflare')) return true;
        }

        return false;
    }

    /**
     * Write validation result to database.
     */
    async saveResult(result) {
        const trx = await db.transaction();
        try {
            // Map status string to DB enum
            const dbStatus = result.status === STATUS.ONLINE ? 'online'
                : result.status === STATUS.OFFLINE ? 'offline'
                : result.status === STATUS.GEO_BLOCKED ? 'geo_blocked'
                : result.status === STATUS.SLOW ? 'slow'
                : result.status === STATUS.INVALID ? 'invalid'
                : 'unknown';

            const isOnline = result.status === STATUS.ONLINE || result.status === STATUS.SLOW;

            // Update stream
            await trx('streams').where('id', result.streamId).update({
                status: dbStatus,
                last_checked: new Date(),
                response_time: result.responseTime,
                http_status: result.httpStatus,
                content_type: result.contentType,
                is_redirect: result.isRedirect,
                redirect_url: result.redirectUrl,
                manifest_valid: result.manifestValid,
                segments_found: result.segmentsFound,
                geo_blocked: result.geoBlocked,
                consecutive_failures: isOnline ? 0 : trx.raw('consecutive_failures + 1'),
                consecutive_successes: isOnline ? trx.raw('consecutive_successes + 1') : 0,
                failures: isOnline ? 0 : trx.raw('failures + 1'),
                updated_at: new Date(),
            });

            // Log health check
            await trx('health_check_log').insert({
                stream_id: result.streamId,
                status: dbStatus,
                response_time: result.responseTime,
                http_status: result.httpStatus,
                error_message: result.error?.substring(0, 500),
            });

            await trx.commit();
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }
}

module.exports = { ValidationService: new ValidationService(), STATUS };
