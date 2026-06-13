// Diagnostic: test channels route middleware chain in isolation
require('dotenv').config();
const http = require('http');

async function run() {
    // Start the server
    const { app } = require('./src/server');
    
    // Create a test server
    const server = http.createServer(app);
    server.listen(3001, async () => {
        console.log('Test server on 3001');
        
        const tests = [
            { path: '/health', label: 'health' },
            { path: '/api/v1/channels/featured', label: 'featured' },
            { path: '/api/v1/channels?limit=2', label: 'channels-list' },
        ];
        
        for (const t of tests) {
            const start = Date.now();
            try {
                const res = await new Promise((resolve, reject) => {
                    const req = http.get(`http://localhost:3001${t.path}`, (res) => {
                        let data = '';
                        res.on('data', d => data += d);
                        res.on('end', () => resolve({ status: res.statusCode, body: data, time: Date.now() - start }));
                    });
                    req.setTimeout(5000, () => {
                        req.destroy();
                        reject(new Error('TIMEOUT after 5s'));
                    });
                    req.on('error', reject);
                });
                console.log(`  ${t.label}: ${res.status} (${res.time}ms) body: ${res.body.substring(0, 80)}`);
            } catch (e) {
                console.log(`  ${t.label}: ${e.message}`);
            }
        }
        
        server.close();
        process.exit(0);
    });
}

run().catch(e => { console.error(e); process.exit(1); });
