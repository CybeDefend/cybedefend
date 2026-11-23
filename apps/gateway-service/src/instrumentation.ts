/**
 * Starts OpenTelemetry before anything it instruments is loaded.
 *
 * The SDK patches a module when it is required, never one that is already
 * loaded. Started from bootstrap(), it came after Fastify, Nest and ioredis:
 * the gateway exported no HTTP server span, no Redis span and no outbound
 * HTTP span from the http module, and every guard span was a
 * root.
 *
 * The image preloads this file (`node --require ./dist/instrumentation.js`,
 * entrypoint.sh), and main.ts imports it first for `nest start`. Loaded twice
 * by both, it runs once.
 */
import * as dotenv from 'dotenv';
import tracer from './tracer';

// main.ts used to start the tracer after Nest's ConfigModule had loaded .env
// (local runs: OTEL_DISABLED, OTEL_EXPORTER_OTLP_ENDPOINT). No .env in images.
dotenv.config();
tracer.start();
