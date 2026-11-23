import {
  AsyncTaskList,
  AsyncTask,
  ListAsyncTasksRequest,
  DeleteAsyncTaskRequest,
} from '@grpc/analysis-reporting/result';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import {
  ResultServiceClient,
  RESULT_SERVICE_NAME,
} from '@grpc/analysis-reporting/analysis_reporting';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';

@Injectable()
export class MeAsyncTasksService implements OnModuleInit {
  private resultServiceClient!: ResultServiceClient;

  constructor(
    @Inject('ANALYSIS_REPORTING_SERVICE') private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.resultServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<ResultServiceClient>(RESULT_SERVICE_NAME),
    );
  }

  @Span()
  async listAsyncTasks(userId: string): Promise<AsyncTask[]> {
    const request: ListAsyncTasksRequest = { userId };
    const response: AsyncTaskList = await safeGrpcCall(
      this.resultServiceClient.listAsyncTasks(request),
    );
    return response.tasks ?? [];
  }

  /**
   * Persisted dismiss: removes a background task so it does not
   * reappear on the next tracker rehydration. Owner-checked in the service.
   */
  @Span()
  async deleteAsyncTask(userId: string, taskId: string): Promise<void> {
    const request: DeleteAsyncTaskRequest = { userId, taskId };
    await safeGrpcCall(this.resultServiceClient.deleteAsyncTask(request));
  }
}
