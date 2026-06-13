-- Migration: add enriched channel view and seed data
-- Run: node backend/src/scripts/run-migrations.js up
CREATE OR REPLACE VIEW v_channels_enriched AS
SELECT
    c.id,
    c.name,
    c.slug,
    c.logo_url,
    c.category_id,
    cat.name AS category_name,
    cat.slug AS category_slug,
    c.country_id,
    co.name AS country_name,
    co.flag AS country_flag,
    co.code AS country_code,
    c.is_active,
    c.is_featured,
    c.is_verified,
    c.view_count,
    c.favorite_count,
    c.play_count,
    c.last_synced_at,
    c.metadata,
    s.name AS source_name,
    s.type AS source_type
FROM channels c
LEFT JOIN categories cat ON c.category_id = cat.id
LEFT JOIN countries co ON c.country_id = co.id
LEFT JOIN sources s ON c.source_id = s.id
WHERE c.is_active = true;

-- DOWN: DROP VIEW v_channels_enriched;

-- Seed: sample categories
INSERT INTO categories (id, name, slug, description, sort_order)
VALUES
    ('c1111111-1111-1111-1111-111111111111', 'Sports', 'sports', 'Live sports channels', 1),
    ('c2222222-2222-2222-2222-222222222222', 'News', 'news', 'News channels', 2),
    ('c3333333-3333-3333-3333-333333333333', 'Entertainment', 'entertainment', 'Entertainment channels', 3),
    ('c4444444-4444-4444-4444-444444444444', 'Movies', 'movies', 'Movie channels', 4),
    ('c5555555-5555-5555-5555-555555555555', 'Kids', 'kids', 'Kids channels', 5)
ON CONFLICT (slug) DO NOTHING;

-- Seed: sample countries
INSERT INTO countries (id, code, name, flag, language, region)
VALUES
    ('n1111111-1111-1111-1111-111111111111', 'US', 'United States', '🇺🇸', 'en', 'NA'),
    ('n2222222-2222-2222-2222-222222222222', 'GB', 'United Kingdom', '🇬🇧', 'en', 'EU'),
    ('n3333333-3333-3333-3333-333333333333', 'DE', 'Germany', '🇩🇪', 'de', 'EU'),
    ('n4444444-4444-4444-4444-444444444444', 'BR', 'Brazil', '🇧🇷', 'pt', 'SA'),
    ('n5555555-5555-5555-5555-555555555555', 'IN', 'India', '🇮🇳', 'hi', 'AS')
ON CONFLICT (code) DO NOTHING;

-- Seed: sample source
INSERT INTO sources (id, name, type, description)
VALUES ('s1111111-1111-1111-1111-111111111111', 'sample', 'manual', 'Sample channel data')
ON CONFLICT (name) DO NOTHING;

-- Seed: 20 sample channels with streams
DO $$
DECLARE
    src_id UUID := 's1111111-1111-1111-1111-111111111111';
    cat_id UUID;
    co_id  UUID;
    i INT := 1;
BEGIN
    SELECT id INTO cat_id FROM categories WHERE slug = 'sports' LIMIT 1;
    SELECT id INTO co_id  FROM countries WHERE code = 'US' LIMIT 1;

    WHILE i <= 20 LOOP
        INSERT INTO channels (id, source_id, name, slug, logo_url, category_id, country_id, is_active, is_featured, is_verified, view_count, favorite_count, play_count, last_synced_at)
        VALUES (
            gen_random_uuid(),
            src_id,
            'Sports Channel ' || LPAD(i::text, 2, '0'),
            'sports-channel-' || LPAD(i::text, 2, '0'),
            'https://cdn.a1tv.example.com/logos/channel-' || i || '.png',
            cat_id,
            co_id,
            true,
            i <= 5,
            true,
            floor(random() * 100000),
            floor(random() * 5000),
            floor(random() * 50000),
            NOW()
        )
        ON CONFLICT (slug) DO NOTHING;

        INSERT INTO streams (id, channel_id, url, quality, status, score, is_active)
        SELECT gen_random_uuid(), c.id,
            'https://stream.a1tv.example.com/live/sports-channel-' || LPAD(i::text, 2, '0') || '/index.m3u8',
            '1080p', 'online', floor(70 + random() * 30), true
        FROM channels c WHERE c.slug = 'sports-channel-' || LPAD(i::text, 2, '0')
        ON CONFLICT DO NOTHING;

        i := i + 1;
    END LOOP;
END $$;
