// ============================================================
// A1TV v4 — Sports Intelligence Service
// Match detection, event timeline, live scoring, sports hub.
//
// Features:
//   - Auto-detect matches from EPG titles
//   - Event timeline (goals, cards, wickets, etc.)
//   - Live/upcoming/finished status tracking
//   - Sports Hub aggregation
// ============================================================

const db = require('../config/database');
const cache = require('./cache');

// ── Sports keyword dictionaries ─────────────────────────────
const SPORTS_KEYWORDS = {
  football: {
    keywords: ['football', 'soccer', 'futbol', 'fútbol', 'calcio', 'fußball'],
    leagues: ['premier league', 'la liga', 'serie a', 'bundesliga', 'ligue 1', 'champions league', 'europa league', 'world cup', 'euro', 'copa america'],
    eventTypes: ['goal', 'penalty', 'red card', 'yellow card', 'offside', 'corner', 'free kick', 'var', 'substitution', 'injury time'],
  },
  cricket: {
    keywords: ['cricket', 'test match', 'odi', 't20', 't-20', 'ipl', 'big bash', 'psl', 'bpl', 'cpl', 'world cup'],
    eventTypes: ['wicket', 'boundary', 'four', 'six', 'wide', 'no ball', 'bye', 'leg bye', 'duck', 'century', 'half century', 'maiden over'],
  },
  basketball: {
    keywords: ['basketball', 'nba', 'euroleague', 'ncaa'],
    eventTypes: ['dunk', 'three pointer', 'free throw', 'block', 'steal', 'assist', 'rebound', 'turnover'],
  },
  tennis: {
    keywords: ['tennis', 'atp', 'wta', 'grand slam', 'wimbledon', 'us open', 'french open', 'australian open', 'roland garros'],
    eventTypes: ['ace', 'double fault', 'break point', 'set point', 'match point', 'tiebreak'],
  },
  rugby: {
    keywords: ['rugby', 'six nations', 'rugby world cup', 'super rugby'],
    eventTypes: ['try', 'conversion', 'penalty', 'drop goal', 'scrum', 'lineout'],
  },
  formula1: {
    keywords: ['formula 1', 'f1', 'grand prix', 'motorsport', 'nascar', 'indycar', 'moto gp', 'motogp'],
    eventTypes: ['pit stop', 'fastest lap', 'overtake', 'safety car', 'drs', 'retirement', 'grid penalty', 'pole position'],
  },
};

// Common team name patterns
const TEAM_PATTERNS = [
  /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:vs|v|versus|@|–|-)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/,
  /([A-Z]{2,4})\s+(?:vs|v|versus|@|–|-)\s+([A-Z]{2,4})/,
];

// ── Match Detection Engine ──────────────────────────────────
class MatchDetector {
  /**
   * Detect if an EPG program title contains a sports match.
   * Returns match info or null.
   */
  detectFromEpg(title, description = '') {
    if (!title) return null;

    const text = `${title} ${description}`.toLowerCase();

    // Detect sport type
    let detectedSport = null;
    for (const [sport, data] of Object.entries(SPORTS_KEYWORDS)) {
      if (data.keywords.some(kw => text.includes(kw)) ||
          data.leagues.some(l => text.includes(l))) {
        detectedSport = sport;
        break;
      }
    }

    if (!detectedSport) return null;

    // Detect teams
    const teams = this.extractTeams(title);

    // Detect league
    const league = this.extractLeague(text, detectedSport);

    // Calculate confidence
    let confidence = 0.5;
    if (teams.home && teams.away) confidence += 0.3;
    if (league) confidence += 0.15;
    if (SPORTS_KEYWORDS[detectedSport].leagues.some(l => text.includes(l))) confidence += 0.1;

    return {
      sport: detectedSport,
      homeTeam: teams.home,
      awayTeam: teams.away,
      league: league || 'Unknown',
      confidence: Math.min(1, confidence),
      originalTitle: title,
    };
  }

  /**
   * Extract team names from a match title.
   */
  extractTeams(title) {
    for (const pattern of TEAM_PATTERNS) {
      const match = title.match(pattern);
      if (match) {
        return { home: match[1].trim(), away: match[2].trim() };
      }
    }

    // Fallback: look for known team abbreviations
    // In production, this would query a teams database
    return { home: null, away: null };
  }

  /**
   * Extract league name from text.
   */
  extractLeague(text, sport) {
    const leagues = SPORTS_KEYWORDS[sport]?.leagues || [];
    for (const league of leagues) {
      if (text.includes(league)) return league;
    }
    return null;
  }
}

const matchDetector = new MatchDetector();

// ── Sports Intelligence Service ─────────────────────────────
class SportsIntelligenceService {
  constructor() {
    this.detector = matchDetector;
  }

  /**
   * Auto-detect matches from EPG programs.
   * Called by the EPG sync worker.
   */
  async detectMatchesFromEpg(channelId, programs) {
    const results = [];

    for (const program of programs) {
      const detection = this.detector.detectFromEpg(
        program.title,
        program.description || ''
      );

      if (detection && detection.confidence > 0.5) {
        // Log detection
        await db('sports_detection_log').insert({
          channel_id: channelId,
          program_title: program.title,
          detected_match: `${detection.homeTeam || '?'} vs ${detection.awayTeam || '?'}`,
          detected_league: detection.league,
          confidence: detection.confidence,
        });

        // Try to find or create the match
        const match = await this.findOrCreateMatch(detection, channelId, program);
        if (match) {
          results.push({ detection, matchId: match.id });
        }
      }
    }

    return results;
  }

  /**
   * Find existing match or create new one from detection.
   */
  async findOrCreateMatch(detection, channelId, program) {
    // Try to find by team names and time range
    const matchTime = program.start_time ? new Date(program.start_time) : new Date();

    let match = await db('sports_matches as sm')
      .join('sports_teams as home', 'sm.home_team_id', 'home.id')
      .join('sports_teams as away', 'sm.away_team_id', 'away.id')
      .where(function() {
        this.where('home.name', 'ilike', `%${detection.homeTeam}%`)
          .orWhere('home.short_name', 'ilike', `%${detection.homeTeam}%`);
      })
      .where(function() {
        this.where('away.name', 'ilike', `%${detection.awayTeam}%`)
          .orWhere('away.short_name', 'ilike', `%${detection.awayTeam}%`);
      })
      .where('sm.match_time', '>=', new Date(matchTime - 3600000))
      .where('sm.match_time', '<=', new Date(matchTime + 3600000))
      .select('sm.*')
      .first();

    if (!match) {
      // Create new match
      const [matchId] = await db('sports_matches').insert({
        channel_id: channelId,
        status: 'scheduled',
        match_time: matchTime,
        detected_at: new Date(),
      }).returning('id');

      match = await db('sports_matches').where({ id: matchId }).first();
    }

    // Update detection log with match reference
    if (match) {
      await db('sports_detection_log')
        .where({ channel_id: channelId, program_title: program.title })
        .whereNull('match_id')
        .update({ match_id: match.id });
    }

    return match;
  }

  /**
   * Add a match event (goal, card, wicket, etc.).
   */
  async addEvent(matchId, event) {
    const {
      eventType,
      eventSubtype,
      teamId,
      playerName,
      minute,
      scoreAfter,
      description,
    } = event;

    const isKey = ['goal', 'penalty', 'red_card', 'wicket', 'six', 'try', 'dunk'].includes(eventType);

    await db('match_events').insert({
      match_id: matchId,
      event_type: eventType,
      event_subtype: eventSubtype || null,
      team_id: teamId || null,
      player_name: playerName || null,
      minute: minute || null,
      score_after: scoreAfter || null,
      description: description || null,
      is_key_event: isKey,
    });

    // Update match score if provided
    if (scoreAfter) {
      const parts = scoreAfter.split(/[-:]/);
      if (parts.length === 2) {
        await db('sports_matches')
          .where({ id: matchId })
          .update({
            home_score: parseInt(parts[0]) || 0,
            away_score: parseInt(parts[1]) || 0,
            updated_at: new Date(),
          });
      }
    }

    // Invalidate timeline cache
    await cache.del(`sports:timeline:${matchId}`);
  }

  /**
   * Get full match timeline for display.
   */
  async getMatchTimeline(matchId) {
    const cacheKey = `sports:timeline:${matchId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const match = await db('sports_matches as sm')
      .join('sports_teams as home', 'sm.home_team_id', 'home.id')
      .join('sports_teams as away', 'sm.away_team_id', 'away.id')
      .leftJoin('sports_leagues as l', 'sm.league_id', 'l.id')
      .where('sm.id', matchId)
      .select(
        'sm.*',
        'home.name as home_team_name',
        'home.logo_url as home_team_logo',
        'away.name as away_team_name',
        'away.logo_url as away_team_logo',
        'l.name as league_name'
      )
      .first();

    if (!match) return null;

    const events = await db('match_events as me')
      .leftJoin('sports_teams as st', 'me.team_id', 'st.id')
      .where('me.match_id', matchId)
      .select('me.*', 'st.name as team_name', 'st.logo_url as team_logo')
      .orderBy('me.created_at', 'asc');

    const timeline = {
      match: {
        id: match.id,
        status: match.status,
        sport: match.metadata?.sport || 'football',
        league: match.league_name,
        homeTeam: { name: match.home_team_name, logo: match.home_team_logo, score: match.home_score },
        awayTeam: { name: match.away_team_name, logo: match.away_team_logo, score: match.away_score },
        matchTime: match.match_time,
        period: match.period,
        clock: match.clock,
        venue: match.venue,
      },
      events: events.map(e => ({
        id: e.id,
        type: e.event_type,
        subtype: e.event_subtype,
        team: e.team_name,
        player: e.player_name,
        minute: e.minute,
        scoreAfter: e.score_after,
        description: e.description,
        isKeyEvent: e.is_key_event,
        timestamp: e.created_at,
      })),
      summary: {
        totalEvents: events.length,
        keyEvents: events.filter(e => e.is_key_event).length,
      },
    };

    await cache.set(cacheKey, timeline, 30);
    return timeline;
  }

  /**
   * Get live matches.
   */
  async getLiveMatches(sport = null, limit = 50) {
    const cacheKey = `sports:live:${sport || 'all'}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    let query = db('sports_matches as sm')
      .join('sports_teams as home', 'sm.home_team_id', 'home.id')
      .join('sports_teams as away', 'sm.away_team_id', 'away.id')
      .leftJoin('sports_leagues as l', 'sm.league_id', 'l.id')
      .whereIn('sm.status', ['live', 'halftime'])
      .select(
        'sm.*',
        'home.name as home_team_name',
        'home.logo_url as home_team_logo',
        'away.name as away_team_name',
        'away.logo_url as away_team_logo',
        'l.name as league_name'
      )
      .orderBy('sm.match_time', 'desc')
      .limit(limit);

    const matches = await query;

    await cache.set(cacheKey, matches, 15);
    return matches;
  }

  /**
   * Get upcoming matches.
   */
  async getUpcomingMatches(sport = null, hours = 24, limit = 50) {
    const cacheKey = `sports:upcoming:${sport || 'all'}:${hours}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const future = new Date(now + hours * 3600000);

    let query = db('sports_matches as sm')
      .join('sports_teams as home', 'sm.home_team_id', 'home.id')
      .join('sports_teams as away', 'sm.away_team_id', 'away.id')
      .leftJoin('sports_leagues as l', 'sm.league_id', 'l.id')
      .where('sm.status', 'scheduled')
      .where('sm.match_time', '>=', now)
      .where('sm.match_time', '<=', future)
      .select(
        'sm.*',
        'home.name as home_team_name',
        'home.logo_url as home_team_logo',
        'away.name as away_team_name',
        'away.logo_url as away_team_logo',
        'l.name as league_name'
      )
      .orderBy('sm.match_time', 'asc')
      .limit(limit);

    const matches = await query;

    await cache.set(cacheKey, matches, 60);
    return matches;
  }

  /**
   * Get finished/recent matches.
   */
  async getFinishedMatches(sport = null, hours = 24, limit = 50) {
    const cacheKey = `sports:finished:${sport || 'all'}:${hours}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const since = new Date(Date.now() - hours * 3600000);

    let query = db('sports_matches as sm')
      .join('sports_teams as home', 'sm.home_team_id', 'home.id')
      .join('sports_teams as away', 'sm.away_team_id', 'away.id')
      .leftJoin('sports_leagues as l', 'sm.league_id', 'l.id')
      .where('sm.status', 'finished')
      .where('sm.match_time', '>=', since)
      .select(
        'sm.*',
        'home.name as home_team_name',
        'home.logo_url as home_team_logo',
        'away.name as away_team_name',
        'away.logo_url as away_team_logo',
        'l.name as league_name'
      )
      .orderBy('sm.match_time', 'desc')
      .limit(limit);

    const matches = await query;

    await cache.set(cacheKey, matches, 300);
    return matches;
  }

  /**
   * Sports Hub: aggregated view of all sports content.
   */
  async getSportsHub(limit = 50) {
    const cacheKey = `sports:hub:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const [live, upcoming, finished, leagues] = await Promise.all([
      this.getLiveMatches(null, 10),
      this.getUpcomingMatches(null, 48, 20),
      this.getFinishedMatches(null, 24, 10),
      db('sports_leagues').where({ is_active: true }).orderBy('name').select('*'),
    ]);

    const hub = {
      live: { count: live.length, matches: live },
      upcoming: { count: upcoming.length, matches: upcoming },
      recent: { count: finished.length, matches: finished },
      leagues,
      liveChannels: [...new Set(live.map(m => m.channel_id).filter(Boolean))],
    };

    await cache.set(cacheKey, hub, 30);
    return hub;
  }

  /**
   * Update match status (called by EPG sync or admin).
   */
  async updateMatchStatus(matchId, status, extras = {}) {
    const update = { status, updated_at: new Date() };

    if (extras.homeScore !== undefined) update.home_score = extras.homeScore;
    if (extras.awayScore !== undefined) update.away_score = extras.awayScore;
    if (extras.period) update.period = extras.period;
    if (extras.clock) update.clock = extras.clock;

    await db('sports_matches').where({ id: matchId }).update(update);

    // Invalidate caches
    await cache.del(`sports:timeline:${matchId}`);
    await cache.del('sports:hub:' + 50);
  }
}

module.exports = {
  SportsIntelligenceService,
  sportsIntelligence: new SportsIntelligenceService(),
  MatchDetector,
  matchDetector,
  SPORTS_KEYWORDS,
};
