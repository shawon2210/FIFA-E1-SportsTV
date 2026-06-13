const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

console.log('Starting A1TV FIFA E1SportsTV v3...');
console.log(`Port: ${PORT}`);
console.log(`Host: ${HOST}`);

const child = spawn('node', ['backend/src/server.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT, HOST, NODE_ENV: process.env.NODE_ENV || 'production' },
});

child.on('error', (err) => {
    console.error('Failed to start backend:', err);
    process.exit(1);
});

child.on('exit', (code) => {
    console.log(`Backend exited with code ${code}`);
    process.exit(code);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    child.kill('SIGTERM');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    child.kill('SIGINT');
    process.exit(0);
});
