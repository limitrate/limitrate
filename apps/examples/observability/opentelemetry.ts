/**
 * OpenTelemetry Integration Example
 *
 * This example shows how to integrate LimitRate with OpenTelemetry
 * for distributed tracing and metrics across your entire stack.
 */

import express from 'express';
import { limitrate } from '@limitrate/express';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

// Initialize OpenTelemetry
const resource = Resource.default().merge(
  new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'limitrate-api',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  })
);

// Configure metrics
const metricExporter = new OTLPMetricExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/metrics',
});

const meterProvider = new MeterProvider({
  resource,
  readers: [
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10000, // Export every 10 seconds
    }),
  ],
});

const meter = meterProvider.getMeter('limitrate');

// Define metrics
const requestCounter = meter.createCounter('limitrate.requests.total', {
  description: 'Total number of rate-limited requests',
});

const blockedCounter = meter.createCounter('limitrate.requests.blocked', {
  description: 'Total number of blocked requests',
});

const costGauge = meter.createObservableGauge('limitrate.cost.current', {
  description: 'Current cost consumption per user',
});

const durationHistogram = meter.createHistogram('limitrate.check.duration', {
  description: 'Duration of rate limit checks in milliseconds',
  unit: 'ms',
});

// Store for cost tracking (in production, use Redis)
const costTracker = new Map<string, number>();

// Register cost gauge callback
costGauge.addCallback((observableResult) => {
  costTracker.forEach((value, key) => {
    const [user, plan, endpoint] = key.split('|');
    observableResult.observe(value, { user, plan, endpoint });
  });
});

const app = express();
app.use(express.json());

// LimitRate middleware with OpenTelemetry integration
app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip || 'anonymous',
  identifyPlan: (req) => req.user?.plan || 'free',

  store: {
    type: 'redis',
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  policies: {
    free: {
      endpoints: {
        'POST|/api/generate': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' },
          cost: {
            estimateCost: (req) => {
              const prompt = req.body?.prompt || '';
              const tokens = Math.ceil(prompt.length / 4);
              return tokens * 0.0000015;
            },
            hourlyCap: 0.10,
            actionOnExceed: 'block',
          },
        },
      },
      defaults: {
        rate: { maxPerMinute: 60, actionOnExceed: 'block' },
      },
    },
    pro: {
      endpoints: {
        'POST|/api/generate': {
          rate: { maxPerMinute: 100, actionOnExceed: 'slowdown', slowdownMs: 500 },
          cost: {
            estimateCost: (req) => {
              const prompt = req.body?.prompt || '';
              const tokens = Math.ceil(prompt.length / 4);
              return tokens * 0.0000015;
            },
            hourlyCap: 5.00,
            actionOnExceed: 'block',
          },
        },
      },
    },
  },

  // Event handler with OpenTelemetry tracing and metrics
  onEvent: async (event) => {
    const tracer = trace.getTracer('limitrate');
    const startTime = Date.now();

    // Create a span for the event
    const span = tracer.startSpan('limitrate.event', {
      attributes: {
        'limitrate.event.type': event.type,
        'limitrate.user': event.user,
        'limitrate.plan': event.plan,
        'limitrate.endpoint': event.endpoint,
        'limitrate.allowed': event.allowed,
        'limitrate.action': event.action || 'unknown',
      },
    });

    const attributes = {
      user: event.user,
      plan: event.plan,
      endpoint: event.endpoint,
      type: event.type,
    };

    try {
      // Record request counter
      requestCounter.add(1, attributes);

      // Record blocked requests
      if (!event.allowed) {
        blockedCounter.add(1, { ...attributes, reason: event.type });

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Request blocked: ${event.type}`,
        });
      }

      // Track cost
      if (event.value !== undefined) {
        const costKey = `${event.user}|${event.plan}|${event.endpoint}`;
        costTracker.set(costKey, event.value);

        span.setAttribute('limitrate.cost.value', event.value);

        if (event.type === 'cost_exceeded') {
          span.addEvent('cost_exceeded', {
            'cost.current': event.value,
            'cost.cap': event.limit || 0,
          });
        }
      }

      // Record duration
      const duration = Date.now() - startTime;
      durationHistogram.record(duration, attributes);

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  },
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Example API endpoint with tracing
app.post('/api/generate', async (req, res) => {
  const tracer = trace.getTracer('api');
  const span = tracer.startSpan('api.generate', {
    attributes: {
      'http.method': 'POST',
      'http.route': '/api/generate',
      'user.id': req.user?.id || 'anonymous',
      'user.plan': req.user?.plan || 'free',
    },
  });

  const ctx = trace.setSpan(context.active(), span);

  try {
    // Simulate AI generation within the span context
    await context.with(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    span.setStatus({ code: SpanStatusCode.OK });

    res.json({
      ok: true,
      message: 'Generation started',
      prompt: req.body.prompt,
    });
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: (error as Error).message,
    });
    throw error;
  } finally {
    span.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('OpenTelemetry tracing and metrics enabled');
  console.log(`Exporting to: ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await meterProvider.shutdown();
  console.log('OpenTelemetry MeterProvider shut down');
  process.exit(0);
});

/**
 * Setup Instructions:
 *
 * 1. Run OpenTelemetry Collector:
 *    docker run -p 4318:4318 otel/opentelemetry-collector
 *
 * 2. Configure collector to export to your backend:
 *    - Jaeger (tracing)
 *    - Prometheus (metrics)
 *    - Grafana (visualization)
 *
 * 3. Set environment variables:
 *    export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *
 * Example Queries:
 *
 * 1. Trace rate limit decisions across microservices
 * 2. Correlate slow requests with rate limit checks
 * 3. Track cost consumption across distributed services
 * 4. Monitor P99 latency of rate limit checks
 */
