// A1TV v2 - Load Test
// Simulates concurrent API requests

var http = require('http');
var CONCURRENCY = parseInt(process.env.CONCURRENCY) || 50;
var REQUESTS = parseInt(process.env.REQUESTS) || 500;
var API = process.env.API || 'http://localhost:3000';

function runLoadTest() {
    console.log('Load Test: ' + REQUESTS + ' requests, ' + CONCURRENCY + ' concurrent');
    var start = Date.now();
    var completed = 0;
    var errors = 0;
    var latencies = [];

    function makeRequest() {
        return new Promise(function(resolve) {
            var reqStart = Date.now();
            http.get(API + '/api/v1/channels?limit=10', function(res) {
                var data = '';
                res.on('data', function(chunk) { data += chunk; });
                res.on('end', function() {
                    latencies.push(Date.now() - reqStart);
                    completed++;
                    if (res.statusCode !== 200) errors++;
                    resolve();
                });
            }).on('error', function() { errors++; completed++; resolve(); });
        });
    }

    var batches = Math.ceil(REQUESTS / CONCURRENCY);
    var p = Promise.resolve();
    for (var b = 0; b < batches; b++) {
        (function() {
            var batch = [];
            for (var i = 0; i < CONCURRENCY && b * CONCURRENCY + i < REQUESTS; i++) {
                batch.push(makeRequest());
            }
            p = p.then(function() { return Promise.all(batch); });
        })();
    }

    p.then(function() {
        var elapsed = Date.now() - start;
        latencies.sort(function(a, b) { return a - b; });
        var p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
        var p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
        var rps = Math.round(completed / (elapsed / 1000));

        console.log('Completed: ' + completed + '/' + REQUESTS);
        console.log('Errors: ' + errors);
        console.log('Time: ' + elapsed + 'ms');
        console.log('RPS: ' + rps);
        console.log('P50: ' + p50 + 'ms');
        console.log('P95: ' + p95 + 'ms');

        if (errors === 0 && p95 < 2000) {
            console.log('\nLoad test PASSED');
            process.exit(0);
        } else {
            console.log('\nLoad test FAILED');
            process.exit(1);
        }
    });
}

runLoadTest();
