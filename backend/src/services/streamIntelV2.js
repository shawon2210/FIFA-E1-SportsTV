// ============================================================
// A1TV v4 — Predictive Stream Intelligence v2
// Upgrades SRS (v1) to a full predictive model that tracks:
//   Failure Frequency
//   Packet Loss
//   CDN Latency (per-region)
//   Viewer Dropoff Rate
//   Buffering Events
//   Reconnect Rate
//   Bitrate Stability
//   HLS Segment Availability
//
// Output: predicted failure probability + confidence score
// Uses exponential moving averages and trend analysis.
// ============================================================

const db = require('../config/database');
const cache = require('../config/services/cache');

// ── Feature Weights (trained from historical patterns) ──────
const FEATURE_WEIGHTS = {
  failureFrequency: 0.25,
  packetLoss: 0.15,
  cdnLatency: 0.15,
  viewerDropoff: 0.15,
  bufferingEvents: 0.10,
  reconnectRate: 0.10,
  bitrateStability: 0.05,
  segmentAvailability: 0.05,
};

// ── EMA (Exponential Moving Average) calculator ─────────────
class EMA {
  constructor(alpha = 0.3) {
    this.alpha = alpha;
    this.value = null;
  }

  update(newValue) {
    if (this.value === null) {
      this.value = newValue;
    } else {
      this.value = this.alpha * newValue + (1 - this.alpha) * this.value;
    }
    return this.value;
  }

  get() {
    return this.value;
  }
}

// ── Per-stream EMA trackers ─────────────────────────────────
const streamTrackers = new Map(); // streamId -> { feature: EMA }

function getTracker(streamId, feature) {
  if (!streamTrackers.has(streamId)) {
    streamTrackers.set(streamId, {});
  }
  const trackers = streamTrackers.get(streamId);
  if (!trackers[feature]) {
    trackers[feature] = new EMA(0.3);
  }
  return trackers[feature];
}

// ── Predictive Model ────────────────────────────────────────
class PredictiveStreamModel {
  constructor() {
    this.emaAlpha = 0.3;
  }

  /**
   * Record a new telemetry event for a stream.
   * Called by the health checker, stream proxy, and WebSocket handler.
   */
  async recordEvent(streamId, event) {
    const {
      failure,
      packetLoss,
      cdnLatency,
      viewerDropoff,
      buffering,
      reconnect,
      bitrateDelta,
      segmentMissing,
      region,
    } = event;

    const updates = {};

    if (failure !== undefined) {
      updates.failureFrequency = getTracker(streamId, 'failureFrequency').update(failure ? 1 : 0);
    }
    if (packetLoss !== undefined) {
      updates.packetLoss = getTracker(streamId, 'packetLoss').update(packetLoss);
    }
    if (cdnLatency !== undefined) {
      updates.cdnLatency = getTracker(streamId, 'cdnLatency').update(cdnLatency);
    }
    if (viewerDropoff !== undefined) {
      updates.viewerDropoff = getTracker(streamId, 'viewerDropoff').update(viewerDropoff);
    }
    if (buffering !== undefined) {
      updates.bufferingEvents = getTracker(streamId, 'bufferingEvents').update(buffering ? 1 : 0);
    }
    if (reconnect !== undefined) {
      updates.reconnectRate = getTracker(streamId, 'reconnectRate').update(reconnect ? 1 : 0);
    }
    if (bitrateDelta !== undefined) {
      // bitrateStability: 1 = perfectly stable, 0 = wild swings
      const stability = Math.max(0, 1 - Math.abs(bitrateDelta));
      updates.bitrateStability = getTracker(streamId, 'bitrateStability').update(stability);
    }
    if (segmentMissing !== undefined) {
      updates.segmentAvailability = getTracker(streamId, 'segmentAvailability').update(segmentMissing ? 0 : 1);
    }

    // Persist to time-series table for historical analysis
    await this.persistTelemetry(streamId, event, region);

    return updates;
  }

  /**
   * Persist telemetry to database for historical trend analysis.
   */
  async persistTelemetry(streamId, event, region) {
    try {
      await db('stream_telemetry').insert({
        stream_id: streamId,
        region: region || 'unknown',
        failure: event.failure || false,
        packet_loss: event.packetLoss || 0,
        cdn_latency: event.cdnLatency || 0,
        viewer_dropoff: event.viewerDropoff || 0,
        buffering: event.buffering || false,
        reconnect: event.reconnect || false,
        bitrate_delta: event.bitrateDelta || 0,
        segment_missing: event.segmentMissing || false,
        recorded_at: new Date(),
      });
    } catch (err) {
      // Non-critical: don't fail the request if telemetry insert fails
      console.error('[StreamIntel v2] Telemetry insert error:', err.message);
    }
  }

  /**
   * Predict failure probability for a stream.
   *
   * Returns:
   *   {
   *     streamId: "abc",
   *     predictedFailure: 0.08,
   *     confidence: 0.92,
   *     features: { ... },
   *     trend: "improving" | "stable" | "degrading",
   *     recommendation: "use" | "monitor" | "avoid"
   *   }
   */
  async predictFailure(streamId) {
    const cacheKey = 'streamintel:v2:prediction:' + streamId;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    // Get current EMA feature values
    const features = {};
    let totalWeight = 0;
    let weightedSum = 0;
    let featuresWithData = 0;

    for (const [feature, weight] of Object.entries(FEATURE_WEIGHTS)) {
      const tracker = getTracker(streamId, feature);
      const value = tracker.get();

      if (value !== null) {
        // Normalize features to 0-1 range (higher = more likely to fail)
        const normalized = this.normalizeFeature(feature, value);
        features[feature] = {
          raw: value,
          normalized,
          weight,
          contribution: normalized * weight,
        };
        weightedSum += normalized * weight;
        totalWeight += weight;
        featuresWithData++;
      } else {
        features[feature] = { raw: null, normalized: null, weight, contribution: 0 };
      }
    }

    // Calculate confidence based on how much data we have
    const confidence = Math.min(0.95, featuresWithData / Object.keys(FEATURE_WEIGHTS).length);

    // Predict failure probability
    const predictedFailure = totalWeight > 0 ? weightedSum / totalWeight : 0.5;

    // Determine trend
    const trend = await this.calculateTrend(streamId);

    // Recommendation
    let recommendation;
    if (predictedFailure < 0.15) {
      recommendation = 'use';
    } else if (predictedFailure < 0.4) {
      recommendation = 'monitor';
    } else {
      recommendation = 'avoid';
    }

    const result = {
      streamId,
      predictedFailure: parseFloat(predictedFailure.toFixed(4)),
      confidence: parseFloat(confidence.toFixed(4)),
      features,
      trend,
      recommendation,
      timestamp: new Date().toISOString(),
    };

    // Cache for 30 seconds (predictions are time-sensitive)
    await cache.set(cacheKey, result, 30);

    return result;
  }

  /**
   * Normalize a feature value to 0-1 range.
   * Higher values = more likely to fail.
   */
  normalizeFeature(feature, value) {
    const ranges = {
      failureFrequency: { min: 0, max: 1 },
      packetLoss: { min: 0, max: 50 },        // 0-50% packet loss
      cdnLatency: { min: 0, max: 5000 },      // 0-5000ms
      viewerDropoff: { min: 0, max: 1 },
      bufferingEvents: { min: 0, max: 1 },
      reconnectRate: { min: 0, max: 1 },
      bitrateStability: { min: 0, max: 1 },   // Inverted: 1 = stable
      segmentAvailability: { min: 0, max: 1 }, // Inverted: 1 = available
    };

    const range = ranges[feature] || { min: 0, max: 1 };
    let normalized = (value - range.min) / (range.max - range.min);

    // Invert features where higher raw = better
    if (feature === 'bitrateStability' || feature === 'segmentAvailability') {
      normalized = 1 - normalized;
    }

    return Math.max(0, Math.min(1, normalized));
  }

  /**
   * Calculate trend by comparing recent EMA to older data.
   */
  async calculateTrend(streamId) {
    try {
      // Get average failure rate from last hour vs previous hour
      const now = new Date();
      const oneHourAgo = new Date(now - 3600000);
      const twoHoursAgo = new Date(now - 7200000);

      const [recent, older] = await Promise.all([
        db('stream_telemetry')
          .where({ stream_id: streamId })
          .where('recorded_at', '>=', oneHourAgo)
          .avg('failure as avg_failure')
          .count('* as count')
          .first(),
        db('stream_telemetry')
          .where({ stream_id: streamId })
          .where('recorded_at', '>=', twoHoursAgo)
          .where('recorded_at', '<', oneHourAgo)
          .avg('failure as avg_failure')
          .count('* as count')
          .first(),
      ]);

      const recentRate = parseFloat(recent?.avg_failure) || 0;
      const olderRate = parseFloat(older?.avg_failure) || 0;

      if (recentRate < olderRate - 0.05) return 'improving';
      if (recentRate > olderRate + 0.05) return 'degrading';
      return 'stable';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Batch predict for multiple streams (used by auto-failover).
   */
  async predictBatch(streamIds) {
    const predictions = await Promise.all(
      streamIds.map(id => this.predictFailure(id))
    );

    // Sort by predicted failure (best first)
    return predictions.sort((a, b) => a.predictedFailure - b.predictedFailure);
  }

  /**
   * Get telemetry summary for a stream.
   */
  async getTelemetrySummary(streamId, hours = 24) {
    const since = new Date(Date.now() - hours * 3600000);

    const summary = await db('stream_telemetry')
      .where({ stream_id: streamId })
      .where('recorded_at', '>=', since)
      .select(
        db.raw('COUNT(*) as total_events'),
        db.raw('SUM(CASE WHEN failure THEN 1 ELSE 0 END) as failure_count'),
        db.raw('AVG(packet_loss) as avg_packet_loss'),
        db.raw('AVG(cdn_latency) as avg_cdn_latency'),
        db.raw('AVG(viewer_dropoff) as avg_viewer_dropoff'),
        db.raw('SUM(CASE WHEN buffering THEN 1 ELSE 0 END) as buffering_count'),
        db.raw('SUM(CASE WHEN reconnect THEN 1 ELSE 0 END) as reconnect_count'),
        db.raw('AVG(bitrate_delta) as avg_bitrate_delta'),
        db.raw('SUM(CASE WHEN segment_missing THEN 1 ELSE 0 END) as segment_missing_count'),
      )
      .first();

    return {
      streamId,
      period: `${hours}h`,
      totalEvents: parseInt(summary?.total_events) || 0,
      failureCount: parseInt(summary?.failure_count) || 0,
      avgPacketLoss: parseFloat(summary?.avg_packet_loss) || 0,
      avgCdnLatency: parseFloat(summary?.avg_cdn_latency) || 0,
      avgViewerDropoff: parseFloat(summary?.avg_viewer_dropoff) || 0,
      bufferingCount: parseInt(summary?.buffering_count) || 0,
      reconnectCount: parseInt(summary?.reconnect_count) || 0,
      avgBitrateDelta: parseFloat(summary?.avg_bitrate_delta) || 0,
      segmentMissingCount: parseInt(summary?.segment_missing_count) || 0,
    };
  }

  /**
   * Clean up trackers for streams that haven't been seen recently.
   */
  cleanup(maxAgeMs = 3600000) {
    // In production, you'd track last-seen timestamps
    // For now, just limit total trackers
    if (streamTrackers.size > 10000) {
      const entries = Array.from(streamTrackers.entries());
      // Remove oldest 20%
      const toRemove = entries.slice(0, Math.floor(entries.length * 0.2));
      for (const [id] of toRemove) {
        streamTrackers.delete(id);
      }
    }
  }
}

// Singleton
const model = new PredictiveStreamModel();

// Cleanup every 5 minutes
setInterval(() => model.cleanup(), 300000);

module.exports = {
  PredictiveStreamModel,
  model,
  EMA,
  FEATURE_WEIGHTS,
};
