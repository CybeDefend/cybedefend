/**
 * Where the service reads its .proto files.
 *
 * - PROTO_BASE_PATH, when set and not blank: that directory. Optional, with no
 *   value in any deployment; it lets a build run outside the Docker image
 *   layout with NODE_ENV=production (e.g. a boot test of the exported tree,
 *   whose protos are in <tree>/libs/protos).
 * - otherwise, NODE_ENV=production: /app/protos, the image layout.
 * - otherwise: the repository's libs/protos (devPath, given by the caller).
 */
export const IMAGE_PROTO_BASE_PATH = '/app/protos';

export interface ProtoBasePathInput {
  nodeEnv: string | undefined;
  /** The value of PROTO_BASE_PATH. */
  override: string | undefined;
  devPath: string;
}

export function resolveProtoBasePath({
  nodeEnv,
  override,
  devPath,
}: ProtoBasePathInput): string {
  const explicit = override?.trim();
  if (explicit) return explicit;
  return nodeEnv === 'production' ? IMAGE_PROTO_BASE_PATH : devPath;
}
