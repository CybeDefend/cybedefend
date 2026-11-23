import { Inject, Injectable } from '@nestjs/common';
import { Span } from 'nestjs-otel';
import {
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@grpc/global-management/global_management';
import { ClientGrpc } from '@nestjs/microservices';
import {
  GetUserProfileRequest,
  GetUserProfileResponse,
  UpdateUserProfileRequest,
  UserUpdateResponse,
  ListPersonalAccessTokensRequest,
  ListPersonalAccessTokensResponse,
  CreatePersonalAccessTokenRequest,
  CreatePersonalAccessTokenResponse,
  DeletePersonalAccessTokenRequest,
  DeletePersonalAccessTokenResponse,
  UpdatePersonalAccessTokenNameRequest,
  UpdatePersonalAccessTokenNameResponse,
} from '@grpc/global-management/user';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import { profileOrganizationFields } from './profile-organization-fields';
@Injectable()
export class UserService {
  private userServiceClient!: UserServiceClient;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.userServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<UserServiceClient>(USER_SERVICE_NAME),
    );
  }

  /**
   * Get user profile information
   *
   * @param data User ID
   * @param req Request HTTP
   * @returns User profile information
   */
  @Span()
  getProfile(data: GetUserProfileRequest): Promise<GetUserProfileResponse> {
    return safeGrpcCall(this.userServiceClient.getUserProfile(data)).then(
      (res) => {
        const mapped: any = {
          ...res,
          myOrganizations: (res.myOrganizations || []).map((org: any) => ({
            ...org,
            ...profileOrganizationFields(org ?? {}),
            // Empty means unknown (billing unreachable), never "no product".
            products: org?.products ?? [],
            // The current member's own products in the organisation
            // (per-member products), read with myProductsKnown below: empty
            // with myProductsKnown true is « no product »; with it false or
            // absent (an older global-management), the list is unknown,
            // never « no access ».
            myProducts: org?.myProducts ?? [],
            // Only true says global-management computed myProducts: true with
            // [] is « no product »; false or absent is unknown.
            myProductsKnown: org?.myProductsKnown === true,
          })),
        };
        return mapped as GetUserProfileResponse;
      },
    );
  }

  /**
   * Update user profile
   *
   * @param req Request HTTP
   * @param data User profile information to update
   * @returns User profile information updated
   */
  @Span()
  updateProfile(data: UpdateUserProfileRequest): Promise<UserUpdateResponse> {
    return safeGrpcCall(this.userServiceClient.updateUser(data));
  }

  // ─── Personal Access Tokens ───

  @Span()
  listPersonalAccessTokens(
    data: ListPersonalAccessTokensRequest,
  ): Promise<ListPersonalAccessTokensResponse> {
    return safeGrpcCall(this.userServiceClient.listPersonalAccessTokens(data));
  }

  @Span()
  createPersonalAccessToken(
    data: CreatePersonalAccessTokenRequest,
  ): Promise<CreatePersonalAccessTokenResponse> {
    return safeGrpcCall(this.userServiceClient.createPersonalAccessToken(data));
  }

  @Span()
  deletePersonalAccessToken(
    data: DeletePersonalAccessTokenRequest,
  ): Promise<DeletePersonalAccessTokenResponse> {
    return safeGrpcCall(this.userServiceClient.deletePersonalAccessToken(data));
  }

  @Span()
  updatePersonalAccessTokenName(
    data: UpdatePersonalAccessTokenNameRequest,
  ): Promise<UpdatePersonalAccessTokenNameResponse> {
    return safeGrpcCall(
      this.userServiceClient.updatePersonalAccessTokenName(data),
    );
  }
}
