export type LumenStreamChannel = "audit" | "transactions";

type Handler = (event: Record<string, unknown>) => void;

export interface SubscribeOptions {
  serverUrl: string;
  channel: LumenStreamChannel;
  apiKey?: string;
  maxReconnectAttempts?: number;
}

export class LumenWebSocketClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(private readonly opts: SubscribeOptions) {}

  on(event: string, handler: Handler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  connect(): void {
    const url = new URL(this.opts.serverUrl.replace(/^http/, "ws"));
    url.pathname = `/ws/${this.opts.channel}`;
    this.ws = new WebSocket(url.toString());
    this.ws.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      this.emit(this.opts.channel, payload);
    };
    this.ws.onclose = () => this.scheduleReconnect();
    this.ws.onerror = () => this.emit("error", { message: "WebSocket error" });
  }

  private scheduleReconnect(): void {
    const max = this.opts.maxReconnectAttempts ?? 5;
    if (this.attempt >= max) return;
    this.attempt += 1;
    this.emit("reconnecting", { attempt: this.attempt });
    const delay = Math.min(1000 * 2 ** this.attempt, 30_000);
    setTimeout(() => this.connect(), delay);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export function subscribe(
  opts: SubscribeOptions,
  handler: Handler,
): LumenWebSocketClient {
  const client = new LumenWebSocketClient(opts);
  client.on(opts.channel, handler);
  client.connect();
  return client;
}