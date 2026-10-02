import {
  StandardLogger,
  StandardMeter,
  StandardTracer,
} from "@devopsplaybook.io/otel-utils";
import { OTelRequestSpan as OTelRequestSpanFromLibrary } from "@devopsplaybook.io/otel-utils-fastify";
import { Span } from "@opentelemetry/sdk-trace-base";

let tracer: StandardTracer;
let meter: StandardMeter;
let logger: StandardLogger;

export function OTelSetTracer(tracerIn: StandardTracer) {
  tracer = tracerIn;
}

export function OTelSetMeter(meterIn: StandardMeter) {
  meter = meterIn;
}

export function OTelTracer(): StandardTracer {
  return tracer;
}

export function OTelMeter(): StandardMeter {
  return meter;
}

export function OTelLogger(): StandardLogger {
  if (!logger) {
    logger = new StandardLogger();
  }
  return logger;
}

export function OTelRequestSpan(req: any): Span {
  return OTelRequestSpanFromLibrary(req) as Span;
}
