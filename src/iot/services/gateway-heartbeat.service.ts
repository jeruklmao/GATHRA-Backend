import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { GatewayHeartbeatDto } from '../dto/gateway-heartbeat.dto';
import { GatewayHeartbeatRepository } from '../repositories/gateway-heartbeat.repository';
import { GatewayHeartbeatEventsService } from './gateway-heartbeat-events.service';

@Injectable()
export class GatewayHeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GatewayHeartbeatService.name);
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: GatewayHeartbeatRepository,
    private readonly events: GatewayHeartbeatEventsService,
  ) {}

  onApplicationBootstrap(): void {
    this.cleanupTimer = setInterval(() => void this.cleanup(), 6 * 60 * 60 * 1_000);
    this.cleanupTimer.unref();
    void this.cleanup();
  }

  onApplicationShutdown(): void {
    if (this.cleanupTimer !== undefined) clearInterval(this.cleanupTimer);
  }

  async accept(dto: GatewayHeartbeatDto): Promise<{ acceptedAt: string; gatewayId: string }> {
    this.validateRelationships(dto);
    if (Buffer.byteLength(JSON.stringify(dto), 'utf8') > 16_384) {
      throw new BadRequestException('Heartbeat payload exceeds 16 KiB');
    }
    const receivedAt = new Date();
    await this.repository.persist(dto, receivedAt);
    const acceptedAt = receivedAt.toISOString();
    this.events.emit({ gatewayId: dto.gateway.gatewayId, receivedAt: acceptedAt });
    return { acceptedAt, gatewayId: dto.gateway.gatewayId };
  }

  list(now?: Date) { return this.repository.list(now); }
  detail(gatewayId: string, now?: Date) { return this.repository.detail(gatewayId, now); }
  metrics(gatewayId: string, range: string) { return this.repository.metrics(gatewayId, range); }
  cleanupNow() { return this.repository.cleanup(30); }

  private async cleanup(): Promise<void> {
    try { await this.repository.cleanup(30); }
    catch (error) { this.logger.warn(`Gateway metrics cleanup failed: ${safeMessage(error)}`); }
  }

  private validateRelationships(d: GatewayHeartbeatDto): void {
    const errors: string[] = [];
    if (d.network.wifiConnected !== (d.network.wifiRssiDbm !== null && d.network.localIp !== null)) errors.push('Wi-Fi state and diagnostics are inconsistent');
    if (d.time.timeValid ? d.time.currentUtc === null : d.time.currentUtc !== null || d.time.lastNtpSyncAt !== null || d.time.ntpAgeSeconds !== null) errors.push('timeValid and time diagnostics are inconsistent');
    for (const value of [d.network.lastBackendSuccessAt,d.network.lastBackendErrorAt,d.time.currentUtc,d.time.lastNtpSyncAt,d.lora.lastLoRaRxAt]) if (value !== null && !validDate(value)) errors.push('Heartbeat contains an invalid timestamp');
    const radio = [d.lora.latestRssiDbm,d.lora.latestSnrDb,d.lora.latestFrequencyErrorHz];
    if (!allNullOrPresent(radio)) errors.push('Latest LoRa metrics must be all null or all present');
    if (d.ack.ackCount !== d.ack.ackSuccessCount + d.ack.ackFailureCount) errors.push('ACK counters are inconsistent');
    if (d.ack.latencySampleCount > d.ack.ackSuccessCount) errors.push('ACK latency samples exceed successful ACKs');
    const latest = [d.ack.latestRxToAckStartMs,d.ack.latestRxToAckCompleteMs,d.ack.latestAckTxDurationMs];
    if (!allNullOrPresent(latest)) errors.push('Latest ACK timings must be all null or all present');
    if (latest[0] !== null && (latest[1] as number) < latest[0]) errors.push('ACK completion precedes ACK start');
    for (const [minimum, maximum, average] of [[d.ack.minRxToAckStartMs,d.ack.maxRxToAckStartMs,d.ack.avgRxToAckStartMs],[d.ack.minRxToAckCompleteMs,d.ack.maxRxToAckCompleteMs,d.ack.avgRxToAckCompleteMs],[d.ack.minAckTxDurationMs,d.ack.maxAckTxDurationMs,d.ack.avgAckTxDurationMs]]) {
      if (!allNullOrPresent([minimum,maximum,average]) || (minimum !== null && !(minimum <= (average as number) && (average as number) <= (maximum as number)))) errors.push('ACK rolling statistics are inconsistent');
    }
    if (d.ack.latencySampleCount === 0 && [...latest,d.ack.minRxToAckStartMs,d.ack.maxRxToAckStartMs,d.ack.avgRxToAckStartMs,d.ack.minRxToAckCompleteMs,d.ack.maxRxToAckCompleteMs,d.ack.avgRxToAckCompleteMs,d.ack.minAckTxDurationMs,d.ack.maxAckTxDurationMs,d.ack.avgAckTxDurationMs].some((v) => v !== null)) errors.push('Empty ACK history must use null timing values');
    if (d.queue.depth > d.queue.capacity) errors.push('Queue depth exceeds capacity');
    if (d.queue.depth === 0 && d.queue.oldestRecordAgeSeconds !== null) errors.push('Empty queue cannot have an oldest record age');
    if (!allNullOrPresent([d.commands.pendingCommandId,d.commands.pendingCommandType,d.commands.pendingCommandState])) errors.push('Pending command fields are inconsistent');
    if (!allNullOrPresent([d.commands.lastCommandId,d.commands.lastCommandResult])) errors.push('Last command fields are inconsistent');
    if (errors.length > 0) throw new BadRequestException(errors.join('; '));
  }
}

function allNullOrPresent(values: readonly unknown[]): boolean { return values.every((v) => v === null) || values.every((v) => v !== null); }
function validDate(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function safeMessage(error: unknown): string { return error instanceof Error ? error.message.replace(/[\r\n\x00-\x1f\x7f]/g, ' ') : 'unknown error'; }
