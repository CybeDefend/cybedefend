export interface APIKey {
  id: string;
  name: string;
  description: string;
  key: string;
  expirationDate: Date;
  status: string;
  createdDate: Date;
  lastModifiedDate: Date;
  authorizedIps: string[];
}

export interface PaginatedAPIKeysResponse {
  apikeys: APIKey[];
  totalApikeys: number;
  totalPages: number;
}

export interface CreateApikeyDto {
  name: string;
  description?: string;
  expirationDate: Date | null;
  status: string;
  authorizedIps: string[];
}

export interface CreateApiKeyResponseDto {
  key: string;
}