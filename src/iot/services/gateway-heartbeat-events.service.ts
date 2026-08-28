import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface GatewayHeartbeatEvent {
  readonly gatewayId: string;
  readonly receivedAt: string;
}

@Injectable()
export class GatewayHeartbeatEventsService {
  private readonly events = new Subject<GatewayHeartbeatEvent>();

  readonly stream = this.events.asObservable();

  emit(event: GatewayHeartbeatEvent): void {
    this.events.next(event);
  }
}
