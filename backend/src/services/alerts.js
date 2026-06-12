// ============================================================
// A1TV v2 — Alert & Notification Service
// Monitors system health and sends alerts via Telegram,
// Discord, Email, or Webhook.
// ============================================================

const axios = require('axios');
const db = require('../config/database');

class AlertService {
    constructor() {
        this.cooldowns = new Map(); // Prevent alert spam
    }

    /**
     * Run all alert checks. Called every minute by a cron.
     */
    async runChecks() {
        const rules = await db('alert_rules').where({ is_active: true });

        for (const rule of rules) {
            // Check cooldown
            const lastTriggered = this.cooldowns.get(rule.id);
            if (lastTriggered && Date.now() - lastTriggered < rule.cooldown_minutes * 60 * 1000) {
                continue;
            }

            try {
                const triggered = await this.evaluateRule(rule);
                if (triggered) {
                    await this.fireAlert(rule, triggered);
                    this.cooldowns.set(rule.id, Date.now());
                }
            } catch (err) {
                console.error(`[Alert] Rule ${rule.name} failed:`, err.message);
            }
        }
    }

    /**
     * Evaluate a single alert rule.
     */
    async evaluateRule(rule) {
        const config = rule.condition_config;

        switch (rule.category) {
            case 'streams': {
                if (config.metric === 'offline_stream_pct') {
                    const stats = await db('streams')
                        .where('is_active', true)
                        .select(
                            db.raw('COUNT(*) as total'),
                            db.raw("COUNT(*) FILTER (WHERE status IN ('offline','invalid')) as offline")
                        ).first();
                    const pct = stats.total > 0 ? (stats.offline / stats.total) * 100 : 0;
                    if (this.compare(pct, config.operator, config.value)) {
                        return { metric: 'offline_stream_pct', value: pct.toFixed(1), threshold: config.value };
                    }
                }
                break;
            }

            case 'sync': {
                if (config.metric === 'last_sync') {
                    const lastSync = await db('sources').max('last_sync as last').first();
                    if (!lastSync?.last || new Date(lastSync.last) < new Date(Date.now() - 12 * 60 * 60 * 1000)) {
                        return { metric: 'last_sync', value: lastSync?.last || 'never' };
                    }
                }
                break;
            }

            case 'database': {
                if (config.metric === 'disk_usage_pct') {
                    const disk = await db.raw("SELECT pg_database_size(current_database()) as size");
                    // Simplified — in production, check actual disk usage
                    return null;
                }
                break;
            }

            case 'api': {
                if (config.metric === 'api_p95_latency_ms') {
                    // Would need Prometheus/metrics integration
                    return null;
                }
                break;
            }
        }

        return null;
    }

    compare(actual, operator, threshold) {
        switch (operator) {
            case '>': return actual > threshold;
            case '>=': return actual >= threshold;
            case '<': return actual < threshold;
            case '<=': return actual <= threshold;
            case '==': return actual === threshold;
            default: return false;
        }
    }

    /**
     * Fire an alert: store in DB and send to notification channels.
     */
    async fireAlert(rule, data) {
        console.log(`[ALERT] ${rule.severity.toUpperCase()}: ${rule.name} —`, JSON.stringify(data));

        // Store in history
        const [alert] = await db('alert_history').insert({
            rule_id: rule.id,
            severity: rule.severity,
            title: rule.name,
            message: this.formatMessage(rule, data),
            data,
        }).returning('*');

        // Update rule last_triggered
        await db('alert_rules').where('id', rule.id).update({ last_triggered: new Date() });

        // Send to notification channels
        const channels = await db('alert_channels').where({ is_active: true });
        for (const channel of channels) {
            try {
                await this.sendToChannel(channel, alert);
            } catch (err) {
                console.error(`[Alert] Failed to send to ${channel.type}:`, err.message);
            }
        }
    }

    formatMessage(rule, data) {
        const messages = {
            'High Offline Rate': `⚠️ ${data.value}% of streams are offline (threshold: ${data.threshold}%)`,
            'Critical Offline Rate': `🚨 ${data.value}% of streams are offline! Immediate attention required.`,
            'Sync Job Failed': `⚠️ Last successful sync was ${data.value}. Check sync service.`,
            'Database Disk High': `🚨 Database disk usage at ${data.value}%`,
        };
        return messages[rule.name] || `${rule.name}: ${JSON.stringify(data)}`;
    }

    async sendToChannel(channel, alert) {
        const config = channel.config;

        switch (channel.type) {
            case 'telegram': {
                const text = `*${alert.severity.toUpperCase()}*\n${alert.message}`;
                await axios.post(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
                    chat_id: config.chat_id,
                    text,
                    parse_mode: 'Markdown',
                });
                break;
            }

            case 'discord': {
                const color = alert.severity === 'critical' ? 0xFF0000 : alert.severity === 'warning' ? 0xFFA500 : 0x00FF00;
                await axios.post(config.webhook_url, {
                    embeds: [{
                        title: alert.title,
                        description: alert.message,
                        color,
                        timestamp: alert.created_at,
                    }],
                });
                break;
            }

            case 'webhook': {
                await axios.post(config.url, {
                    severity: alert.severity,
                    title: alert.title,
                    message: alert.message,
                    data: alert.data,
                    timestamp: alert.created_at,
                });
                break;
            }

            case 'email': {
                // Would integrate with SendGrid/SES
                console.log(`[Alert] Email to ${config.to}: ${alert.message}`);
                break;
            }
        }
    }
}

module.exports = new AlertService();
