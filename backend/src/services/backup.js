// ============================================================
// A1TV v2 — Backup Service
// Automated Postgres + Redis backups to S3/R2.
// ============================================================

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');

const execAsync = promisify(exec);

class BackupService {
    constructor() {
        this.backupDir = process.env.BACKUP_DIR || '/tmp/a1tv-backups';
        this.retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
    }

    /**
     * Run a full backup cycle.
     */
    async runFullBackup() {
        const jobId = await this.createJob('postgres_full');
        const startedAt = new Date();

        try {
            // Ensure backup directory exists
            if (!fs.existsSync(this.backupDir)) {
                fs.mkdirSync(this.backupDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `a1tv_postgres_${timestamp}.sql.gz`;
            const filepath = path.join(this.backupDir, filename);

            // Run pg_dump
            const dbUrl = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
            await execAsync(`pg_dump "${dbUrl}" | gzip > "${filepath}"`);

            // Calculate checksum
            const hash = crypto.createHash('sha256');
            const fileBuffer = fs.readFileSync(filepath);
            hash.update(fileBuffer);
            const checksum = hash.digest('hex');
            const fileSize = fs.statSync(filepath).size;

            // Upload to S3/R2 if configured
            let storagePath = filepath;
            if (process.env.S3_BUCKET) {
                storagePath = await this.uploadToS3(filepath, filename);
            }

            // Update job
            await db('backup_jobs').where('id', jobId).update({
                status: 'completed',
                storage_path: storagePath,
                file_size: fileSize,
                checksum,
                completed_at: new Date(),
                duration_seconds: Math.round((Date.now() - startedAt) / 1000),
            });

            // Cleanup old backups
            await this.cleanup();

            console.log(`[Backup] Complete: ${filename} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
            return { filename, fileSize, checksum };

        } catch (err) {
            await db('backup_jobs').where('id', jobId).update({
                status: 'failed',
                error_message: err.message,
                completed_at: new Date(),
            });
            throw err;
        }
    }

    /**
     * Run Redis snapshot backup.
     */
    async runRedisBackup() {
        const jobId = await this.createJob('redis_snapshot');
        const startedAt = new Date();

        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `a1tv_redis_${timestamp}.rdb`;
            const filepath = path.join(this.backupDir, filename);

            // Trigger BGSAVE and copy the RDB file
            const redisHost = process.env.REDIS_HOST || 'localhost';
            const redisPort = process.env.REDIS_PORT || '6379';
            await execAsync(`redis-cli -h ${redisHost} -p ${redisPort} BGSAVE`);
            await execAsync(`scp ${redisHost}:/data/dump.rdb "${filepath}"`);

            const fileSize = fs.statSync(filepath).size;

            await db('backup_jobs').where('id', jobId).update({
                status: 'completed',
                storage_path: filepath,
                file_size: fileSize,
                completed_at: new Date(),
                duration_seconds: Math.round((Date.now() - startedAt) / 1000),
            });

            console.log(`[Backup] Redis snapshot: ${filename}`);
        } catch (err) {
            await db('backup_jobs').where('id', jobId).update({
                status: 'failed',
                error_message: err.message,
            });
            throw err;
        }
    }

    async createJob(type) {
        const [job] = await db('backup_jobs').insert({ type, status: 'running', started_at: new Date() }).returning('id');
        return job.id;
    }

    async uploadToS3(filepath, filename) {
        // In production, use AWS SDK or @aws-sdk/client-s3
        // For R2, use the S3-compatible API
        const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
        const s3 = new S3Client({
            region: 'auto',
            endpoint: process.env.S3_ENDPOINT,
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY,
                secretAccessKey: process.env.S3_SECRET_KEY,
            },
        });

        await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: `backups/${filename}`,
            Body: fs.createReadStream(filepath),
        }));

        return `s3://${process.env.S3_BUCKET}/backups/${filename}`;
    }

    async cleanup() {
        const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
        const old = await db('backup_jobs')
            .where('created_at', '<', cutoff)
            .where('status', 'completed')
            .select('id', 'storage_path');

        for (const job of old) {
            try {
                if (job.storage_path.startsWith('s3://')) {
                    // Delete from S3
                } else if (fs.existsSync(job.storage_path)) {
                    fs.unlinkSync(job.storage_path);
                }
            } catch {}
        }

        await db('backup_jobs').where('created_at', '<', cutoff).delete();
        console.log(`[Backup] Cleaned up ${old.length} old backups`);
    }

    async getBackupHistory(limit = 20) {
        return db('backup_jobs')
            .orderBy('created_at', 'desc')
            .limit(limit);
    }
}

module.exports = new BackupService();
