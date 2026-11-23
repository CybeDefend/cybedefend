import gatewayAPI from "../api/gatewayAPI";
import { CreateApikeyDto, CreateApiKeyResponseDto, PaginatedAPIKeysResponse } from '../interfaces/ApiKey';

export const fetchUserApiKeys = async (
  page: number,
  pageSize: number,
  searchQuery: string
): Promise<PaginatedAPIKeysResponse> => {
  try {
    const response = await gatewayAPI.get<PaginatedAPIKeysResponse>(`/apikeys`, {
      params: {
        page,
        pageSize,
        search: searchQuery,
      },
    });

    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const deleteApiKey = async (apiKeyId: string): Promise<void> => {
  try {
    await gatewayAPI.delete(`/apikey/${apiKeyId}`);
  } catch (error: any) {
    throw error;
  }
};
  

export const createApiKey = async (createApikeyDto: CreateApikeyDto): Promise<CreateApiKeyResponseDto> => {
  try {
    const formattedDto = {
      ...createApikeyDto,
      expirationDate: createApikeyDto?.expirationDate?.toISOString(),
    };
    const response = await gatewayAPI.post(`/apikey`, formattedDto);
    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const regenerateApiKey = async (apiKeyId: string): Promise<CreateApiKeyResponseDto> => {
  try {
    const response = await gatewayAPI.put(`/apikey/${apiKeyId}`);
    return response.data;
  }
  catch (error: any) {
    throw error;
  }
}