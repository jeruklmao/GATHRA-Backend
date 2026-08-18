import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { readConfiguration } from '../../configuration';
import type {
  NodeListQueryDto,
  TelemetryHistoryQueryDto,
} from '../dto/monitoring-query.dto';
import type {
  MonitoringNodeSummary,
  MonitoringTelemetry,
} from '../models/monitoring.models';
import { IotMonitoringRepository } from '../repositories/iot-monitoring.repository';

const DEFAULT_MONITOR_LIMIT = 200;

@Injectable()
export class IotMonitoringService {
  private readonly maximumLimit = readConfiguration().iotMonitorMaxLimit;

  constructor(private readonly repository: IotMonitoringRepository) {}

  listNodes(query: NodeListQueryDto): Promise<MonitoringNodeSummary[]> {
    return this.repository.listNodes(this.limit(query.limit));
  }

  async getNode(nodeId: string): Promise<MonitoringNodeSummary> {
    const node = await this.repository.getNode(nodeId);
    if (node === null) throw new NotFoundException('IoT Node was not found');
    return node;
  }

  async history(
    nodeId: string,
    query: TelemetryHistoryQueryDto,
  ): Promise<{
    readonly nodeId: string;
    readonly items: MonitoringTelemetry[];
    readonly nextBeforeId: number | null;
  }> {
    const limit = this.limit(query.limit);
    const from = query.from === undefined ? undefined : new Date(query.from);
    const to = query.to === undefined ? undefined : new Date(query.to);
    if (from !== undefined && to !== undefined && from > to) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }
    await this.getNode(nodeId);
    const items = await this.repository.history(nodeId, {
      limit,
      ...(query.beforeId === undefined ? {} : { beforeId: query.beforeId }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      includeRaw: query.includeRaw === true,
    });
    return {
      nodeId,
      items,
      nextBeforeId: items.length === limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private limit(requested: number | undefined): number {
    const value =
      requested ?? Math.min(DEFAULT_MONITOR_LIMIT, this.maximumLimit);
    if (value > this.maximumLimit) {
      throw new BadRequestException(
        `limit exceeds configured maximum of ${this.maximumLimit}`,
      );
    }
    return value;
  }
}
