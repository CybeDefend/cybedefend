#!/usr/bin/env node
// CybeDefend Community Edition: the compose healthcheck of the gRPC services.
//
// Calls grpc.health.v1.Health/Check({ service: '' }) with a 3 s deadline, using
// the @grpc/grpc-js and @grpc/proto-loader the service image already ships
// (found through NODE_PATH) and the proto at /app/protos/health/health.proto.
//
// CLI: node grpc-health.cjs <host:port>; exit 0 iff SERVING.

'use strict';

const DEADLINE_MS = 3000;
const HEALTH_PROTO = '/app/protos/health/health.proto';

/** Resolves true iff the client answers SERVING before deadlineMs; never rejects. */
function checkHealth(client, deadlineMs) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (healthy) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(healthy);
    };
    const timer = setTimeout(() => settle(false), deadlineMs);
    try {
      client.Check({ service: '' }, { deadline: new Date(Date.now() + deadlineMs) }, (err, response) => {
        settle(!err && !!response && (response.status === 'SERVING' || response.status === 1));
      });
    } catch {
      settle(false);
    }
  });
}

module.exports.checkHealth = checkHealth;

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node grpc-health.cjs <host:port>');
    process.exit(1);
  }
  const grpc = require('@grpc/grpc-js');
  const protoLoader = require('@grpc/proto-loader');
  const definition = protoLoader.loadSync(HEALTH_PROTO, { keepCase: true, enums: String, defaults: true });
  const { Health } = grpc.loadPackageDefinition(definition).grpc.health.v1;
  const client = new Health(target, grpc.credentials.createInsecure());
  checkHealth(client, DEADLINE_MS).then((healthy) => {
    client.close();
    process.exit(healthy ? 0 : 1);
  });
}
