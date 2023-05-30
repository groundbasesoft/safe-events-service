import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAmqpConnectionManager } from 'amqp-connection-manager/dist/esm/AmqpConnectionManager';
import { Channel, ConsumeMessage } from 'amqplib';
import amqp, { ChannelWrapper } from 'amqp-connection-manager';

@Injectable()
export class QueueProvider implements OnApplicationShutdown {
  private readonly logger = new Logger('QueueProvider');
  private connection: IAmqpConnectionManager;
  private channelWrapper: ChannelWrapper;

  constructor(private readonly configService: ConfigService) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onApplicationShutdown(signal?: string) {
    // Not enabled by default
    // https://docs.nestjs.com/fundamentals/lifecycle-events#application-shutdown
    return this.disconnect();
  }

  getAmqpUrl(): string {
    return this.configService.getOrThrow('AMQP_URL');
  }

  getQueueName(): string {
    return this.configService.get('AMQP_QUEUE') ?? 'safe-events-service';
  }

  getExchangeName(): string {
    return (
      this.configService.get('AMQP_EXCHANGE') ??
      'safe-transaction-service-events'
    );
  }

  async getConnection() {
    if (!this.connection || !this.connection.isConnected()) {
      await this.connect();
    }

    return {
      connection: this.connection,
      channel: this.channelWrapper,
    };
  }

  async connect() {
    this.logger.debug(
      'Connecting to RabbitMQ and creating exchange/queue if not created',
    );
    // Connection will be succesful even if RabbitMQ is down, connection will be retried until it's up
    this.connection = amqp.connect(this.getAmqpUrl());
    this.channelWrapper = this.connection.createChannel({
      json: true,
      setup: async (channel: Channel) => {
        channel.assertExchange(this.getExchangeName(), 'fanout', {
          durable: true,
        });

        channel.assertQueue(this.getQueueName(), {
          durable: true,
        });

        return channel.bindQueue(
          this.getQueueName(),
          this.getExchangeName(),
          '',
        );
      },
    });
  }

  public disconnect(): void {
    this.channelWrapper && this.channelWrapper.close();
    this.connection && this.connection.close();
    // TODO Empty variables
    // this.channelWrapper = undefined;
    // this.connection = undefined;
  }

  /**
   * @returns consumerTag for the event
   */
  async subscribeToEvents(
    func: (arg: string) => Promise<any>,
  ): Promise<string> {
    const { channel } = await this.getConnection();
    this.logger.debug(
      `Subscribing to RabbitMQ exchange ${this.getExchangeName()} and queue ${this.getQueueName()}`,
    );
    const consumer = await channel.consume(
      this.getQueueName(),
      (message: ConsumeMessage) => {
        if (message.content) func(message.content.toString());
      },
      {
        noAck: true,
      },
    );
    return consumer.consumerTag;
  }
}
