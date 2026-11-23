import { RpcException } from '@nestjs/microservices';

/**
 * A StartScan failure the scan row already carries in its
 * right state — an import scan that was failed (`IMPORT_UNAVAILABLE`, …) or
 * refused at its start. `ScanController.startScan`'s catch must not record
 * another failure over it, so it rethrows this error untouched.
 */
export class HandledScanStartError extends RpcException {}
