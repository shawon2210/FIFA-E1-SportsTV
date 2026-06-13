-- ============================================================
-- A1TV v4 — Seed Data
-- Initial data for development/testing
-- ============================================================

-- ── Categories
INSERT INTO categories (name, slug, description, icon, sort_order) VALUES
    ('News', 'news', '24/7 news channels', '📰', 1),
    ('Sports', 'sports', 'Live sports broadcasts', '⚽', 2),
    ('Entertainment', 'entertainment', 'Movies, series, shows', '🎬', 3),
    ('Music', 'music', 'Music channels', '🎵', 4),
    ('Documentary', 'documentary', 'Documentaries and educational', '📚', 5),
    ('Kids', 'kids', 'Children programming', '🧒', 6),
    ('Lifestyle', 'lifestyle', 'Food, travel, home', '🏠', 7),
    ('Science', 'science', 'Science and technology', '🔬', 8)
ON CONFLICT (slug) DO NOTHING;

-- ── Countries
INSERT INTO countries (code, code3, name, native_name, flag, language, region) VALUES
    ('US', 'USA', 'United States', 'United States', '🇺🇸', 'en', 'Americas'),
    ('GB', 'GBR', 'United Kingdom', 'United Kingdom', '🇬🇧', 'en', 'Europe'),
    ('DE', 'DEU', 'Germany', 'Deutschland', '🇩🇪', 'de', 'Europe'),
    ('FR', 'FRA', 'France', 'France', '🇫🇷', 'fr', 'Europe'),
    ('IN', 'IND', 'India', 'भारत', '🇮🇳', 'hi', 'Asia'),
    ('BD', 'BGD', 'Bangladesh', 'বাংলাদেশ', '🇧🇩', 'bn', 'Asia'),
    ('JP', 'JPN', 'Japan', '日本', '🇯🇵', 'ja', 'Asia'),
    ('BR', 'BRA', 'Brazil', 'Brasil', '🇧🇷', 'pt', 'Americas'),
    ('AU', 'AUS', 'Australia', 'Australia', '🇦🇺', 'en', 'Oceania'),
    ('CA', 'CAN', 'Canada', 'Canada', '🇨🇦', 'en', 'Americas')
ON CONFLICT (code) DO NOTHING;

-- ── Sports Leagues
INSERT INTO sports_leagues (name, slug, sport, country) VALUES
    ('Premier League', 'premier-league', 'football', 'England'),
    ('La Liga', 'la-liga', 'football', 'Spain'),
    ('UEFA Champions League', 'champions-league', 'football', 'Europe'),
    ('Indian Premier League', 'ipl', 'cricket', 'India'),
    ('NBA', 'nba', 'basketball', 'United States'),
    ('Formula 1', 'formula-1', 'formula1', 'International')
ON CONFLICT (slug) DO NOTHING;

-- ── Sample Channels
INSERT INTO channels (name, slug, language, is_active, is_featured, view_count) VALUES
    ('BBC News', 'bbc-news', 'en', true, true, 150000),
    ('CNN International', 'cnn-international', 'en', true, true, 120000),
    ('ESPN', 'espn', 'en', true, true, 200000),
    ('Star Sports', 'star-sports', 'en', true, true, 180000),
    ('Al Jazeera', 'al-jazeera', 'en', true, true, 90000),
    ('France 24', 'france-24', 'fr', true, false, 60000),
    ('DW News', 'dw-news', 'de', true, false, 45000),
    ('NHK World', 'nhk-world', 'ja', true, false, 30000)
ON CONFLICT (slug) DO NOTHING;
