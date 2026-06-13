// Test: can we load the server module and start it?
require('dotenv').config();
console.log('Step 1: dotenv loaded');

const { app, server } = require('./src/server');
console.log('Step 2: server module loaded');

server.listen(3005, () => {
    console.log('Step 3: server listening on 3005');
    
    // Quick health check
    const http = require('http');
    http.get('http://localhost:3005/health', (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
            console.log('Health:', res.statusCode, d.substring(0,100));
            server.close();
            process.exit(0);
        });
    });
});

setTimeout(() => {
    console.error('TIMEOUT');
    process.exit(1);
}, 15000);
