require('dotenv').config();
console.log('dotenv OK');

// Test websocket.js loading in isolation with all prior modules loaded
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./src/config');
const cache = require('./src/services/cache');
const rateLimiter = require('./src/services/rateLimiter');
console.log('All prior modules loaded');

// Now try websocket
console.log('About to require websocket...');
const ws = require('./src/services/websocket');
console.log('websocket OK!');
process.exit(0);
