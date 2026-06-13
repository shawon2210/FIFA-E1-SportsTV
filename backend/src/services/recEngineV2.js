// ============================================================
// A1TV v4 — AI Recommendation Engine v2
// Embedding-based recommendations using pgvector.
//
// Capabilities:
//   - "Users who watched this also watched..."
//   - "Similar programs"
//   - "Related sports"
//   - Personalized home feed
//   - Content-based + collaborative filtering hybrid
//
// Uses pgvector for approximate nearest neighbor search.
// Falls back to v1 trending/similar if embeddings unavailable.
// ============================================================

const db = require('../config/database');
const cache = require('./cache');
const config = require('../config');

// ── Embedding Generator ─────────────────────────────────────
// In production, this calls an embedding API (OpenAI, Ollama, etc.)
// For now, we generate deterministic embeddings from features.
class EmbeddingGenerator {
  constructor(dim = 384) {
    this.dim = dim;
  }

  /**
   * Generate a deterministic embedding from text features.
   * Uses a simple hash-based approach for local development.
   * In production, replace with actual embedding model API call.
   */
  generateFromFeatures(features) {
    const vector = new Array(this.dim).fill(0);
    const text = Object.entries(features)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');

    // Hash-based embedding (deterministic, no ML required)
    for (let i = 0; i < text.length; i++) {
      const hash = this.hashChar(text, i);
      vector[hash.index] += hash.value;
    }

    // Normalize to unit length
    return this.normalize(vector);
  }

  /**
   * Generate channel embedding from channel metadata.
   */
  generateChannelEmbedding(channel) {
    const features = {
      name: channel.name || '',
      category: channel.category || channel.category_id || '',
      language: channel.language || '',
      country: channel.country || channel.country_id || '',
      tags: (channel.metadata?.tags || []).join(' '),
      description: channel.description || '',
    };
    return this.generateFromFeatures(features);
  }

  /**
   * Generate user embedding from watch history.
   */
  async generateUserEmbedding(userId) {
    // Get user's watch history categories and channels
    const watchData = await db('watch_history as wh')
      .join('channels as c', 'wh.channel_id', 'c.id')
      .where('wh.user_id', userId)
      .where('wh.started_at', '>', new Date(Date.now() - 30 * 24 * 3600000))
      .select(
        db.raw('ARRAY_AGG(DISTINCT c.category_id) as categories'),
        db.raw('ARRAY_AGG(DISTINCT c.id) as channels'),
        db.raw('COUNT(*) as watch_count'),
        db.raw('AVG(wh.duration) as avg_duration')
      )
      .first();

    if (!watchData || !watchData.watch_count) {
      // Cold start: return zero vector
      return new Array(this.dim).fill(0);
    }

    const features = {
      categories: (watchData.categories || []).join(' '),
      channels: (watchData.channels || []).join(' '),
      watchCount: String(watchData.watch_count),
      avgDuration: String(Math.round(watchData.avg_duration || 0)),
    };

    return this.generateFromFeatures(features);
  }

  hashChar(text, position) {
    let hash = 0;
    for (let i = 0; i < 8; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt((position + i) % text.length)) | 0;
    }
    return {
      index: Math.abs(hash) % this.dim,
      value: (Math.abs(hash) % 100) / 100 - 0.5, // -0.5 to 0.5
    };
  }

  normalize(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vector;
    return vector.map(v => v / magnitude);
  }
}

const embeddingGen = new EmbeddingGenerator(384);

// ── Recommendation Engine v2 ────────────────────────────────
class RecommendationEngineV2 {
  constructor() {
    this.embeddingGen = embeddingGen;
  }

  /**
   * Find similar channels using pgvector cosine similarity.
   */
  async findSimilarChannels(channelId, limit = 10) {
    const cacheKey = `rec:v2:similar:${channelId}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    // Get the channel's embedding
    const channelEmb = await db('channel_embeddings')
      .where({ channel_id: channelId })
      .orderBy('updated_at', 'desc')
      .first();

    if (!channelEmb) {
      // Fallback to v1 similar
      return this.fallbackSimilar(channelId, limit);
    }

    // Find nearest neighbors using pgvector
    const similar = await db.raw(`
      SELECT
        ce.channel_id,
        c.name,
        c.slug,
        c.logo_url,
        c.category_id,
        1 - (ce.embedding <=> ?) AS similarity
      FROM channel_embeddings ce
      JOIN channels c ON c.id = ce.channel_id
      WHERE ce.channel_id != ?
        AND c.is_active = true
      ORDER BY ce.embedding <=> ?
      LIMIT ?
    `, [channelEmb.embedding, channelId, channelEmb.embedding, limit]);

    const results = similar.rows || similar || [];
    await cache.set(cacheKey, results, 300);
    return results;
  }

  /**
   * "Users who watched this also watched..."
   * Collaborative filtering via user embeddings.
   */
  async findCollaborativeRecommendations(channelId, limit = 10) {
    const cacheKey = `rec:v2:collab:${channelId}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    // Find users who watched this channel
    const viewers = await db('watch_history')
      .where({ channel_id: channelId })
      .where('started_at', '>', new Date(Date.now() - 7 * 24 * 3600000))
      .select('user_id')
      .distinct()
      .limit(100);

    if (!viewers.length) return [];

    const viewerIds = viewers.map(v => v.user_id);

    // Find what else these users watched
    const recommendations = await db('watch_history as wh')
      .join('channels as c', 'wh.channel_id', 'c.id')
      .whereIn('wh.user_id', viewerIds)
      .where('wh.channel_id', '!=', channelId)
      .where('wh.started_at', '>', new Date(Date.now() - 7 * 24 * 3600000))
      .where('c.is_active', true)
      .select(
        'c.id',
        'c.name',
        'c.slug',
        'c.logo_url',
        'c.category_id',
        db.raw('COUNT(DISTINCT wh.user_id) as viewer_overlap'),
        db.raw('AVG(wh.duration) as avg_watch_duration')
      )
      .groupBy('c.id', 'c.name', 'c.slug', 'c.logo_url', 'c.category_id')
      .orderByRaw('COUNT(DISTINCT wh.user_id) DESC')
      .limit(limit);

    await cache.set(cacheKey, recommendations, 300);
    return recommendations;
  }

  /**
   * Personalized home feed for a user.
   * Combines: user embedding similarity + trending + collaborative.
   */
  async getPersonalizedFeed(userId, limit = 30) {
    const cacheKey = `rec:v2:feed:${userId}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    // Get user embedding
    const userEmb = await db('user_embeddings')
      .where({ user_id: userId })
      .orderBy('updated_at', 'desc')
      .first();

    let embeddingResults = [];
    let trendingResults = [];
    let collabResults = [];

    if (userEmb) {
      // Content-based: find channels matching user preference vector
      const embResults = await db.raw(`
        SELECT
          ce.channel_id as id,
          c.name,
          c.slug,
          c.logo_url,
          c.category_id,
          1 - (ce.embedding <=> ?) AS score,
          'embedding' as source
        FROM channel_embeddings ce
        JOIN channels c ON c.id = ce.channel_id
        WHERE c.is_active = true
          AND ce.channel_id NOT IN (
            SELECT channel_id FROM watch_history
            WHERE user_id = ? AND started_at > NOW() - INTERVAL '1 hour'
          )
        ORDER BY ce.embedding <=> ?
        LIMIT ?
      `, [userEmb.embedding, userId, userEmb.embedding, Math.floor(limit * 0.4)]);
      embeddingResults = embResults.rows || embResults || [];
    }

    // Trending (v1 fallback, always available)
    const trending = await db('channels')
      .where({ is_active: true })
      .orderBy('view_count', 'desc')
      .limit(Math.floor(limit * 0.3))
      .select('id', 'name', 'slug', 'logo_url', 'category_id', db.raw('view_count as score'), db.raw("'trending' as source"));
    trendingResults = trending;

    // Collaborative: channels watched by similar users
    const collab = await db.raw(`
      SELECT DISTINCT
        c.id, c.name, c.slug, c.logo_url, c.category_id,
        COUNT(*) as score,
        'collaborative' as source
      FROM watch_history wh1
      JOIN watch_history wh2 ON wh1.channel_id = wh2.channel_id AND wh1.user_id != wh2.user_id
      JOIN channels c ON c.id = wh2.channel_id
      WHERE wh1.user_id = ?
        AND wh2.user_id != ?
        AND c.is_active = true
        AND wh2.started_at > NOW() - INTERVAL '7 days'
      GROUP BY c.id, c.name, c.slug, c.logo_url, c.category_id
      ORDER BY score DESC
      LIMIT ?
    `, [userId, userId, Math.floor(limit * 0.3)]);
    collabResults = collab.rows || collab || [];

    // Merge and deduplicate
    const seen = new Set();
    const merged = [];

    for (const item of [...embeddingResults, ...collabResults, ...trendingResults]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
      if (merged.length >= limit) break;
    }

    await cache.set(cacheKey, merged, 120);
    return merged;
  }

  /**
   * Find related sports content.
   */
  async findRelatedSports(channelId, limit = 10) {
    const cacheKey = `rec:v2:sports:${channelId}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    // Get sports-related channels
    const sportsChannels = await db('channels as c')
      .join('categories as cat', 'c.category_id', 'cat.id')
      .where('c.is_active', true)
      .where('c.id', '!=', channelId)
      .where(function() {
        this.where('cat.slug', 'sports')
          .orWhere('cat.slug', 'like', '%sport%')
          .orWhere('c.name', 'ilike', '%sport%')
          .orWhere('c.name', 'ilike', '%football%')
          .orWhere('c.name', 'ilike', '%cricket%')
          .orWhere('c.name', 'ilike', '%soccer%');
      })
      .select('c.id', 'c.name', 'c.slug', 'c.logo_url', 'c.category_id')
      .orderBy('c.view_count', 'desc')
      .limit(limit);

    await cache.set(cacheKey, sportsChannels, 600);
    return sportsChannels;
  }

  /**
   * Queue an entity for embedding generation.
   */
  async queueEmbedding(entityType, entityId, priority = 5) {
    await db('embedding_queue')
      .insert({ entity_type: entityType, entity_id: entityId, priority })
      .onConflict(['entity_type', 'entity_id'])
      .merge({ status: 'pending', priority, attempts: 0, error: null });
  }

  /**
   * Process the embedding queue (called by worker).
   */
  async processQueue(batchSize = 50) {
    const items = await db('embedding_queue')
      .where({ status: 'pending' })
      .orderBy('priority', 'asc')
      .orderBy('created_at', 'asc')
      .limit(batchSize);

    const results = [];

    for (const item of items) {
      try {
        await db('embedding_queue')
          .where({ id: item.id })
          .update({ status: 'processing', attempts: item.attempts + 1 });

        if (item.entity_type === 'channel') {
          await this.generateAndStoreChannelEmbedding(item.entity_id);
        } else if (item.entity_type === 'user') {
          await this.generateAndStoreUserEmbedding(item.entity_id);
        }

        await db('embedding_queue')
          .where({ id: item.id })
          .update({ status: 'done', processed_at: new Date() });

        results.push({ id: item.id, status: 'done' });
      } catch (err) {
        await db('embedding_queue')
          .where({ id: item.id })
          .update({
            status: item.attempts >= 3 ? 'failed' : 'pending',
            error: err.message,
          });
        results.push({ id: item.id, status: 'error', error: err.message });
      }
    }

    return results;
  }

  /**
   * Generate and store channel embedding.
   */
  async generateAndStoreChannelEmbedding(channelId) {
    const channel = await db('channels')
      .where({ id: channelId })
      .first();

    if (!channel) return;

    const embedding = this.embeddingGen.generateChannelEmbedding(channel);

    await db('channel_embeddings')
      .insert({
        channel_id: channelId,
        embedding,
        model_version: 'v1-hash',
        metadata: { source: 'hash-based', features: ['name', 'category', 'language'] },
        updated_at: new Date(),
      })
      .onConflict(['channel_id', 'model_version'])
      .merge({
        embedding,
        updated_at: new Date(),
      });
  }

  /**
   * Generate and store user embedding.
   */
  async generateAndStoreUserEmbedding(userId) {
    const embedding = await this.embeddingGen.generateUserEmbedding(userId);

    await db('user_embeddings')
      .insert({
        user_id: userId,
        embedding,
        model_version: 'v1-hash',
        updated_at: new Date(),
      })
      .onConflict(['user_id', 'model_version'])
      .merge({
        embedding,
        updated_at: new Date(),
      });
  }

  /**
   * Fallback to v1 similar channels.
   */
  async fallbackSimilar(channelId, limit) {
    const channel = await db('channels').where({ id: channelId }).first();
    if (!channel) return [];

    return db('channels')
      .where({ is_active: true, category_id: channel.category_id })
      .where('id', '!=', channelId)
      .orderBy('view_count', 'desc')
      .limit(limit)
      .select('id', 'name', 'slug', 'logo_url', 'category_id');
  }
}

module.exports = {
  RecommendationEngineV2,
  engineV2: new RecommendationEngineV2(),
  EmbeddingGenerator,
  embeddingGen,
};
