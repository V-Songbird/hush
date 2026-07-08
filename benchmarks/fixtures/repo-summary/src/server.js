'use strict';
const http = require('node:http');
const { route } = require('./routes.js');
const { verifyToken } = require('./auth.js');

// Thin HTTP front: authenticates, then hands the request to the route table.
function createServer() {
  return http.createServer((req, res) => {
    const user = verifyToken(req.headers['authorization']);
    if (!user) {
      res.writeHead(401).end('unauthorized');
      return;
    }
    route(req, res, user);
  });
}

if (require.main === module) {
  createServer().listen(process.env.PORT || 8080);
}

module.exports = { createServer };
