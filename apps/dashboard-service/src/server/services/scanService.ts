import axios from "axios";
import gatewayAPI from "../api/gatewayAPI";
import { ScanResponseDto, StartScanResponseDto, UploadFileResponse } from "../interfaces/Scan";
import { StartPublicContainerScanBodyDto } from "../interfaces/Body";
import { StartContainerScanResponse } from "../interfaces/Scan";
import { profiler } from "@/utils/profiler";

interface StartScanOptions {
  branch?: string;
  /**
   * The space the archive is analysed for. Another space than AppSec asks for a graph-only
   * analysis (code graph and rule mining, no AppSec scan, no AppSec counter).
   * Left out: an AppSec scan, as before.
   */
  product?: string;
}

const startScan = profiler('startScan')(async (projectId: string, options?: StartScanOptions): Promise<UploadFileResponse> => {
  const fields = {
    ...(options?.branch ? { branch: options.branch } : {}),
    ...(options?.product ? { product: options.product } : {}),
  };
  const body = Object.keys(fields).length > 0 ? fields : undefined;
  const { data } = await gatewayAPI.post<UploadFileResponse>(
    `/project/${projectId}/scan/start`,
    body,
  );
  return data; // { url, scanId }
});

const uploadFileToSignedUrl = profiler('uploadFileToSignedUrl')(async (
  signedUrl: string, 
  file: File, 
  onUploadProgress?: (progressEvent: any) => void
) => {
  const isGcp = signedUrl.includes("googleapis.com");
  const headers: Record<string, string> = { "Content-Type": "application/zip" };

  if (isGcp) {
    headers["x-goog-if-generation-match"] = "0";
    headers["x-goog-content-length-range"] = "0,5368709120";
  }

  await axios.put(signedUrl, file, { 
    headers,
    onUploadProgress
  }); 
});

const getScanById = profiler('getScanById')(async (
  projectId: string,
  scanId: string
): Promise<ScanResponseDto> => {
  try {
    const response = await gatewayAPI.get(
      `/project/${projectId}/scan/${scanId}`
    );
    return response.data;
  } catch (error) {
    throw error;
  }
});

/**
 * Start a public container scan (no credentials needed)
 * POST /project/:projectId/scan/container/start
 */
const startPublicContainerScan = profiler('startPublicContainerScan')(async (
  projectId: string,
  imageToScan: string,
  options?: {
    branch?: string;
    vulnerabilityTypes?: string[];
  }
): Promise<StartContainerScanResponse> => {
  const payload: StartPublicContainerScanBodyDto = {
    imageToScan,
    branch: options?.branch || undefined,
    vulnerabilityTypes: options?.vulnerabilityTypes,
    sourceType: 'manual',
  };
  const { data } = await gatewayAPI.post<StartContainerScanResponse>(
    `/project/${projectId}/scan/container/start`,
    payload
  );
  return data;
});

const cancelScan = async (projectId: string, scanId: string) => {
  const { data } = await gatewayAPI.post(
    `/project/${projectId}/scan/${scanId}/cancel`,
  );
  return data;
};

export default {
  startScan,
  getScanById,
  uploadFileToSignedUrl,
  cancelScan,
  startPublicContainerScan,
};

